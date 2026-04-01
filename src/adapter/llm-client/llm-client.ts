/**
 * LlmClient — unified interface for all LLM operations.
 *
 * Five core methods: complete, completeStream, embed, describeImage, rerank.
 * Internal routing: ModelRouter → adapter → retry → normalize → CostTracker.
 *
 * Supports config hot-reload: when ConfigProvider emits changes to 'apiKeys'
 * or 'llm', adapters are rebuilt and routing updates automatically.
 *
 * Implements VisionCapable (for ProcessModule injection)
 * and EmbedFunction (for RAG injection).
 *
 * See spec: section 1 — LlmClient Unified Interface
 */

import type { ApiKeysConfig } from '../../core/types/config';
import type { Logger } from '../../core/infra/logger';
import type { ConfigProvider } from '../../core/infra/config-provider';
import type { VisionCapable, EmbedFunction } from '../../core/types/common';
import type { RankedChunk } from '../../core/types/chunk';

import { ModelRouter, type ModelRoute, getModelContextWindow } from './model-router';
import { ClaudeAdapter } from './claude-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { RerankerScheduler } from './reranker';
import { retryableCall } from './retry-engine';
import { CostTracker, type CostStats } from './cost-tracker';
import { countTokens } from './token-counter';

// ─── Core types (exported for adapter implementations) ───

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  mediaType?: string;
  data?: string; // base64
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FinishReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'content_filter';

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  usage: TokenUsage;
  finishReason: FinishReason;
  /**
   * Model's reasoning/chain-of-thought content (if available).
   * Present for deepseek-reasoner's reasoning_content.
   * Not fed to output parsers — preserved for audit/transparency.
   */
  reasoning?: string | null;
}

export type StreamChunk =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; delta: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_end'; text: string; usage: TokenUsage; finishReason: FinishReason; reasoning?: string | null }
  | { type: 'error'; code: string; message: string };

// ─── Adapter interface (implemented by Claude and OpenAI adapters) ───

export interface AdapterCallParams {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  workflowId?: string;
  responseFormat?: ResponseFormat;
  /** Extended thinking budget (Claude). Ignored by non-supporting adapters. */
  thinkingBudget?: number;
}

export interface LlmAdapter {
  complete(params: AdapterCallParams): Promise<CompletionResult>;

  completeStream(params: AdapterCallParams): AsyncIterable<StreamChunk>;

  describeImage(
    imageBase64: string,
    mediaType: string,
    prompt: string,
    maxTokens: number,
    model?: string,
  ): Promise<string>;
}

// ─── Structured output ───

export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  /** Schema name (required by OpenAI) */
  name: string;
  /** JSON Schema definition */
  schema: Record<string, unknown>;
  /** If true, model must strictly adhere to schema (OpenAI strict mode) */
  strict?: boolean;
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | JsonSchemaResponseFormat;

// ─── Complete request params ───

export interface CompleteParams {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  workflowId?: string;
  signal?: AbortSignal;
  /** Request structured output (JSON schema or json_object mode) */
  responseFormat?: ResponseFormat;
  /** Extended thinking token budget (Claude only; ignored by other providers). */
  thinkingBudget?: number;
}

// ─── LlmClient ───

export class LlmClient implements VisionCapable {
  private readonly router: ModelRouter;
  private adapters: Map<string, LlmAdapter> = new Map();
  private readonly costTracker: CostTracker;
  private readonly reranker: RerankerScheduler;
  private readonly embedFn: EmbedFunction | null;
  private readonly logger: Logger;
  private readonly configProvider: ConfigProvider;
  private readonly unsubscribe: () => void;
  private localAdapterConfigs = new Map<string, { apiKey: string; baseURL: string; provider: string }>();

  constructor(params: {
    configProvider: ConfigProvider;
    logger: Logger;
    reranker: RerankerScheduler;
    embedFn?: EmbedFunction | null;
  }) {
    this.logger = params.logger;
    this.configProvider = params.configProvider;
    this.costTracker = new CostTracker();
    this.reranker = params.reranker;
    this.embedFn = params.embedFn ?? null;

    // ModelRouter reads config lazily via getters — always up-to-date
    this.router = new ModelRouter({
      getLlmConfig: () => this.configProvider.config.llm,
      getApiKeys: () => this.configProvider.config.apiKeys,
    });

    this.buildAdapters(params.configProvider.config.apiKeys);

    // React to config changes: rebuild adapters when API keys change
    this.unsubscribe = params.configProvider.onChange((event) => {
      if (event.changedSections.includes('apiKeys')) {
        this.logger.info('API keys changed — rebuilding LLM adapters');
        this.buildAdapters(event.current.apiKeys);
      }
    });
  }

  /**
   * Build (or rebuild) provider adapters from current API keys.
   * Clears existing cloud adapters; local adapter configs are always re-added.
   */
  private buildAdapters(keys: ApiKeysConfig): void {
    this.adapters = new Map();
    this.localAdapterConfigs = new Map();

    if (keys.anthropicApiKey) {
      this.adapters.set('anthropic', new ClaudeAdapter(keys.anthropicApiKey));
    }

    if (keys.openaiApiKey) {
      this.adapters.set('openai', new OpenAIAdapter({
        apiKey: keys.openaiApiKey,
        provider: 'openai',
      }));
    }

    if (keys.deepseekApiKey) {
      this.adapters.set('deepseek', new OpenAIAdapter({
        apiKey: keys.deepseekApiKey,
        baseURL: 'https://api.deepseek.com/v1',
        provider: 'deepseek',
      }));
    }

    if (keys.siliconflowApiKey) {
      this.adapters.set('siliconflow', new OpenAIAdapter({
        apiKey: keys.siliconflowApiKey,
        baseURL: 'https://api.siliconflow.cn/v1',
        provider: 'siliconflow',
      }));
    }

    // Local adapters: only create on first use via lazy getter
    this.localAdapterConfigs.set('ollama', {
      apiKey: '',
      baseURL: 'http://localhost:11434/v1',
      provider: 'ollama',
    });
    this.localAdapterConfigs.set('vllm', {
      apiKey: '',
      baseURL: 'http://localhost:8000/v1',
      provider: 'vllm',
    });
  }

  // ─── complete (§1.1) ───

  async complete(params: CompleteParams): Promise<CompletionResult> {
    const route = this.router.resolveAndValidate(params.workflowId);
    const adapter = this.getAdapter(route);
    const startTime = Date.now();

    const adapterParams = this.buildAdapterParams(route, params);

    const result = await retryableCall(
      () => adapter.complete(adapterParams),
      {
        maxRetries: 3,
        ...(params.signal != null && { signal: params.signal }),
        model: route.model,
        onRetry: (attempt, delayMs, error) => {
          this.logger.warn('LLM call failed, retrying', {
            attempt,
            delayMs,
            model: route.model,
            error: (error as Error).message,
          });
        },
      },
    );

    this.recordCost(route, result.usage, Date.now() - startTime, params.workflowId);
    return result;
  }

  // ─── completeStream (§1.1) ───

  async *completeStream(params: CompleteParams): AsyncIterable<StreamChunk> {
    const route = this.router.resolveAndValidate(params.workflowId);
    const adapter = this.getAdapter(route);
    const startTime = Date.now();

    const adapterParams = this.buildAdapterParams(route, params);
    const stream = adapter.completeStream(adapterParams);

    // Proactive timeouts via Promise.race (§5.5)
    const FIRST_TOKEN_TIMEOUT = 30_000;
    const INTER_TOKEN_TIMEOUT = 10_000;

    const iterator = (stream as AsyncIterable<StreamChunk>)[Symbol.asyncIterator]();
    let firstTokenReceived = false;

    try {
      while (true) {
        const timeoutMs = firstTokenReceived ? INTER_TOKEN_TIMEOUT : FIRST_TOKEN_TIMEOUT;

        let timerId!: ReturnType<typeof setTimeout>;
        const timeoutP = new Promise<null>(r => { timerId = setTimeout(() => r(null), timeoutMs); });

        const result = await Promise.race([
          iterator.next().finally(() => clearTimeout(timerId)),
          timeoutP,
        ]);

        if (result === null) {
          yield {
            type: 'error',
            code: firstTokenReceived ? 'INTER_TOKEN_TIMEOUT' : 'FIRST_TOKEN_TIMEOUT',
            message: firstTokenReceived
              ? `No output for ${INTER_TOKEN_TIMEOUT / 1000}s`
              : `No response within ${FIRST_TOKEN_TIMEOUT / 1000}s`,
          };
          return;
        }

        if (result.done) break;
        const chunk = result.value;

        if (!firstTokenReceived && (chunk.type === 'text_delta' || chunk.type === 'tool_use_start')) {
          firstTokenReceived = true;
        }

        if (chunk.type === 'message_end') {
          this.recordCost(route, chunk.usage, Date.now() - startTime, params.workflowId);
        }

        yield chunk;
      }
    } finally {
      if (iterator.return) await iterator.return();
    }
  }

  // ─── embed (§1.1) — proxy to Embedder ───

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.embedFn) {
      throw new Error('Embed function not configured — no embedding backend available');
    }
    return this.embedFn.embed(texts);
  }

  // ─── describeImage (§1.1) — VisionCapable implementation ───

  async describeImage(
    imageBase64: string,
    mimeType: 'image/png' | 'image/jpeg',
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    // Route via workflowOverrides['vision']; falls back to global default.
    // Configure vision model via llm.workflowOverrides.vision in settings.
    const route = this.router.resolveAndValidate('vision');
    const adapter = this.getAdapter(route);

    return retryableCall(
      () => adapter.describeImage(imageBase64, mimeType, prompt, maxTokens, route.model),
      { maxRetries: 2 },
    );
  }

  // ─── rerank (§1.1) — proxy to RerankerScheduler ───

  async rerank(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    return this.reranker.rerank(query, candidates, topK);
  }

  // ─── Cost stats (for IPC exposure) ───

  getCostStats(): CostStats {
    return this.costTracker.getCostStats();
  }

  /** Attach a persistence callback for audit logging (e.g., to SQLite). */
  setCostPersistFn(fn: Parameters<CostTracker['setPersistFn']>[0]): void {
    this.costTracker.setPersistFn(fn);
  }

  // ──��� Token counting ───

  countTokens(text: string, workflowId?: string): number {
    const model = workflowId
      ? this.router.resolveAndValidate(workflowId).model
      : undefined;
    return countTokens(text, model);
  }

  // ─── Model context window ───

  getContextWindow(workflowId?: string): number {
    const route = this.router.resolveAndValidate(workflowId);
    return getModelContextWindow(route.model);
  }

  /** Resolve model name for a workflow (for external token counting). */
  resolveModel(workflowId?: string): string {
    return this.router.resolveAndValidate(workflowId).model;
  }

  // ─── Convenience: create EmbedFunction adapter ───

  asEmbedFunction(): EmbedFunction {
    return { embed: (texts) => this.embed(texts) };
  }

  // ─── Convenience: create VisionCapable adapter ───

  asVisionCapable(): VisionCapable {
    return {
      describeImage: (img, mime, prompt, maxTok) =>
        this.describeImage(img, mime, prompt, maxTok),
    };
  }

  // ─── Lifecycle ───

  async terminate(): Promise<void> {
    this.unsubscribe();
    await this.reranker.terminate();
  }

  // ─── Internal ───

  /** Build unified adapter call params from route + CompleteParams. */
  private buildAdapterParams(route: ModelRoute, params: CompleteParams): AdapterCallParams {
    const p: AdapterCallParams = {
      model: route.model,
      systemPrompt: params.systemPrompt,
      messages: params.messages,
    };
    if (params.tools != null) p.tools = params.tools;
    if (params.maxTokens != null) p.maxTokens = params.maxTokens;
    if (params.temperature != null) p.temperature = params.temperature;
    if (params.signal != null) p.signal = params.signal;
    if (params.workflowId != null) p.workflowId = params.workflowId;
    if (params.responseFormat != null) p.responseFormat = params.responseFormat;
    if (params.thinkingBudget != null) p.thinkingBudget = params.thinkingBudget;
    return p;
  }

  /** Record LLM cost to the cost tracker. */
  private recordCost(
    route: ModelRoute,
    usage: TokenUsage,
    durationMs: number,
    workflowId?: string,
  ): void {
    this.costTracker.record({
      model: route.model,
      provider: route.provider,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs,
      ...(workflowId != null && { workflowId }),
    });
  }

  private getAdapter(route: ModelRoute): LlmAdapter {
    let adapter = this.adapters.get(route.provider);
    if (!adapter) {
      // Lazy-instantiate local adapters on first use
      const localConfig = this.localAdapterConfigs.get(route.provider);
      if (localConfig) {
        adapter = new OpenAIAdapter(localConfig);
        this.adapters.set(route.provider, adapter);
      } else {
        throw new Error(
          `No adapter for provider "${route.provider}". Available: ${Array.from(this.adapters.keys()).join(', ')}`,
        );
      }
    }
    return adapter;
  }
}

// ─── Factory ───

export interface CreateLlmClientOpts {
  configProvider: ConfigProvider;
  logger: Logger;
  reranker: RerankerScheduler;
  embedFn?: EmbedFunction | null;
}

export function createLlmClient(opts: CreateLlmClientOpts): LlmClient {
  return new LlmClient(opts);
}
