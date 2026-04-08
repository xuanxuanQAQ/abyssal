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

import {
  ModelRouter,
  type ModelRoute,
  type ResolvedReasoning,
  getModelContextWindow,
  inferProviderForModel,
  isAvailableRoute,
} from './model-router';
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
  /** Tokens spent on reasoning/thinking (subset of outputTokens for most providers). */
  reasoningTokens?: number;
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
  | { type: 'thinking_delta'; delta: string }
  | { type: 'connected' }
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
  /** Provider-agnostic reasoning configuration. Adapters translate to provider-specific params. */
  reasoning?: ResolvedReasoning | null;
  /** @deprecated Use reasoning instead. Kept for backward compat during migration. */
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
  /** Explicit model override for this call. Provider is inferred when possible. */
  model?: string;
  /** Optional explicit provider override when model inference is insufficient. */
  provider?: string;
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

  /** LRU dedup cache for embeddings — avoids re-embedding identical texts. */
  private readonly embedCache = new Map<string, { vector: Float32Array; ts: number }>();
  private static readonly EMBED_CACHE_MAX = 512;
  private static readonly EMBED_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

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
      this.adapters.set('anthropic', new ClaudeAdapter(keys.anthropicApiKey, this.logger));
    }

    if (keys.openaiApiKey) {
      this.adapters.set('openai', new OpenAIAdapter({
        apiKey: keys.openaiApiKey,
        provider: 'openai',
        logger: this.logger,
      }));
    }

    if (keys.geminiApiKey) {
      this.adapters.set('gemini', new OpenAIAdapter({
        apiKey: keys.geminiApiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        provider: 'gemini',
        logger: this.logger,
      }));
    }

    if (keys.deepseekApiKey) {
      this.adapters.set('deepseek', new OpenAIAdapter({
        apiKey: keys.deepseekApiKey,
        baseURL: 'https://api.deepseek.com/v1',
        provider: 'deepseek',
        logger: this.logger,
      }));
    }

    if (keys.siliconflowApiKey) {
      this.adapters.set('siliconflow', new OpenAIAdapter({
        apiKey: keys.siliconflowApiKey,
        baseURL: 'https://api.siliconflow.cn/v1',
        provider: 'siliconflow',
        logger: this.logger,
      }));
    }

    if (keys.doubaoApiKey) {
      this.adapters.set('doubao', new OpenAIAdapter({
        apiKey: keys.doubaoApiKey,
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        provider: 'doubao',
        logger: this.logger,
      }));
    }

    if (keys.kimiApiKey) {
      this.adapters.set('kimi', new OpenAIAdapter({
        apiKey: keys.kimiApiKey,
        baseURL: 'https://api.moonshot.cn/v1',
        provider: 'kimi',
        logger: this.logger,
      }));
    }

    // Local adapters: only create on first use via lazy getter
    this.localAdapterConfigs.set('vllm', {
      apiKey: '',
      baseURL: 'http://localhost:8000/v1',
      provider: 'vllm',
    });
  }

  // ─── complete (§1.1) ───

  async complete(params: CompleteParams): Promise<CompletionResult> {
    const route = this.resolveRequestedRoute(params);
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
    const route = this.resolveRequestedRoute(params);
    const adapter = this.getAdapter(route);
    const startTime = Date.now();

    this.logger.info('[completeStream] Starting', {
      model: route.model,
      provider: route.provider,
      workflowId: params.workflowId ?? null,
      reasoning: route.reasoning ?? null,
      hasSignal: !!params.signal,
      systemPromptLen: params.systemPrompt.length,
      messageCount: params.messages.length,
    });

    const adapterParams = this.buildAdapterParams(route, params);
    const stream = adapter.completeStream(adapterParams);

    this.logger.debug('[completeStream] Adapter stream created, waiting for first chunk', {
      model: route.model,
      provider: route.provider,
    });

    // Proactive timeouts via Promise.race (§5.5)
    // Three phases: CONNECT → wait for API to respond, FIRST_TOKEN → wait for content, INTER_TOKEN → between tokens
    const CONNECT_TIMEOUT = 30_000;
    const FIRST_TOKEN_TIMEOUT = 120_000;  // Models like doubao-seed may think internally for >30s
    const INTER_TOKEN_TIMEOUT = 30_000;  // API may pause between content and final usage/finish chunks

    const iterator = (stream as AsyncIterable<StreamChunk>)[Symbol.asyncIterator]();
    let connected = false;
    let firstTokenReceived = false;
    let chunkCount = 0;

    try {
      while (true) {
        const timeoutMs = firstTokenReceived
          ? INTER_TOKEN_TIMEOUT
          : connected
            ? FIRST_TOKEN_TIMEOUT
            : CONNECT_TIMEOUT;

        let timerId!: ReturnType<typeof setTimeout>;
        const timeoutP = new Promise<null>(r => { timerId = setTimeout(() => r(null), timeoutMs); });

        const result = await Promise.race([
          iterator.next().finally(() => clearTimeout(timerId)),
          timeoutP,
        ]);

        if (result === null) {
          const elapsed = Date.now() - startTime;
          const code = firstTokenReceived
            ? 'INTER_TOKEN_TIMEOUT'
            : connected
              ? 'FIRST_TOKEN_TIMEOUT'
              : 'CONNECT_TIMEOUT';
          this.logger.error(`[completeStream] Timeout: ${code}`, undefined, {
            model: route.model,
            provider: route.provider,
            workflowId: params.workflowId ?? null,
            elapsedMs: elapsed,
            timeoutMs,
            connected,
            firstTokenReceived,
            chunksReceived: chunkCount,
          });
          yield {
            type: 'error',
            code,
            message: `No ${connected ? 'content' : 'response'} within ${timeoutMs / 1000}s`,
          };
          return;
        }

        if (result.done) break;
        const chunk = result.value;
        chunkCount++;

        // 'connected' — adapter confirmed API responded, switch to longer first-token timeout
        if (chunk.type === 'connected') {
          if (!connected) {
            connected = true;
            this.logger.info('[completeStream] Connected — API responded, waiting for first content token', {
              model: route.model,
              provider: route.provider,
              elapsedMs: Date.now() - startTime,
            });
          }
          continue; // Don't yield internal signal to consumers
        }

        if (!firstTokenReceived && (chunk.type === 'text_delta' || chunk.type === 'tool_use_start' || chunk.type === 'thinking_delta')) {
          const ttft = Date.now() - startTime;
          this.logger.info('[completeStream] First token received', {
            model: route.model,
            provider: route.provider,
            chunkType: chunk.type,
            ttftMs: ttft,
          });
          connected = true;
          firstTokenReceived = true;
        }

        // Log adapter-level errors that arrive as chunks (not timeouts)
        if (chunk.type === 'error') {
          this.logger.error('[completeStream] Adapter error chunk', undefined, {
            model: route.model,
            provider: route.provider,
            code: chunk.code,
            message: chunk.message,
            elapsedMs: Date.now() - startTime,
            chunksReceived: chunkCount,
          });
        }

        if (chunk.type === 'message_end') {
          this.logger.info('[completeStream] Stream complete', {
            model: route.model,
            provider: route.provider,
            totalChunks: chunkCount,
            elapsedMs: Date.now() - startTime,
            usage: chunk.usage,
            finishReason: chunk.finishReason,
          });
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

    const now = Date.now();
    const results: (Float32Array | null)[] = new Array(texts.length).fill(null);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache — dedup identical texts within and across calls
    for (let i = 0; i < texts.length; i++) {
      const cached = this.embedCache.get(texts[i]!);
      if (cached && (now - cached.ts) < LlmClient.EMBED_CACHE_TTL_MS) {
        results[i] = cached.vector;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]!);
      }
    }

    // Embed only uncached texts
    if (uncachedTexts.length > 0) {
      const startTime = Date.now();
      const freshVectors = await this.embedFn.embed(uncachedTexts);

      // Estimate embed token consumption.
      // CJK characters are ~1-2 tokens each vs ~1 token per 4 Latin chars.
      const estimatedTokens = uncachedTexts.reduce((sum, t) => {
        const cjkCount = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]/g) || []).length;
        const otherCount = t.length - cjkCount;
        return sum + cjkCount + Math.ceil(otherCount / 4);
      }, 0);
      this.costTracker.record({
        model: 'embed',
        provider: 'embed',
        inputTokens: estimatedTokens,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        workflowId: 'embed',
      });

      // Populate results and cache
      for (let j = 0; j < uncachedIndices.length; j++) {
        const idx = uncachedIndices[j]!;
        const vec = freshVectors[j]!;
        results[idx] = vec;
        this.embedCache.set(uncachedTexts[j]!, { vector: vec, ts: now });
      }

      // Evict oldest entries if cache exceeds limit
      if (this.embedCache.size > LlmClient.EMBED_CACHE_MAX) {
        const entries = [...this.embedCache.entries()]
          .sort((a, b) => a[1].ts - b[1].ts);
        const toRemove = entries.slice(0, entries.length - LlmClient.EMBED_CACHE_MAX);
        for (const [key] of toRemove) this.embedCache.delete(key);
      }
    }

    return results as Float32Array[];
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

    const startTime = Date.now();
    const result = await retryableCall(
      () => adapter.describeImage(imageBase64, mimeType, prompt, maxTokens, route.model),
      { maxRetries: 2 },
    );

    // Estimate token cost for vision calls — rough but provides visibility.
    // Image ≈ base64 length / 4 * 0.75 bytes → ~1 token per 4 chars of base64.
    const estimatedInput = Math.ceil(imageBase64.length / 4) + Math.ceil(prompt.length / 4);
    const estimatedOutput = Math.ceil(result.length / 4);
    this.recordCost(route, { inputTokens: estimatedInput, outputTokens: estimatedOutput }, Date.now() - startTime, 'vision');

    return result;
  }

  // ─── rerank (§1.1) — proxy to RerankerScheduler ───

  async rerank(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    const startTime = Date.now();
    const result = await this.reranker.rerank(query, candidates, topK);

    // Estimate rerank token consumption: query + each candidate chunk.
    const estimatedTokens = Math.ceil(query.length / 4) +
      candidates.reduce((sum, c) => sum + Math.ceil((c.text ?? '').length / 4), 0);
    this.costTracker.record({
      model: 'rerank',
      provider: 'rerank',
      inputTokens: estimatedTokens,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      workflowId: 'rerank',
    });

    return result;
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
    // Reasoning: explicit thinkingBudget (legacy) > route-level reasoning config
    if (params.thinkingBudget != null) {
      p.reasoning = { level: 'high', budgetTokens: params.thinkingBudget };
    } else if (route.reasoning) {
      p.reasoning = route.reasoning;
    }
    return p;
  }

  private resolveRequestedRoute(params: CompleteParams): ModelRoute {
    if (params.model == null && params.provider == null) {
      return this.router.resolveAndValidate(params.workflowId);
    }

    const baseRoute = this.router.resolve(params.workflowId);
    const resolvedRoute: ModelRoute = {
      provider: params.provider
        ?? (params.model ? inferProviderForModel(params.model) : null)
        ?? baseRoute.provider,
      model: params.model ?? baseRoute.model,
      ...(baseRoute.reasoning !== undefined && { reasoning: baseRoute.reasoning }),
    };

    if (!isAvailableRoute(resolvedRoute, this.configProvider.config.apiKeys)) {
      throw new Error(
        `Provider "${resolvedRoute.provider}" is not configured — please set its API key in settings.` +
        (params.workflowId ? ` (workflow: ${params.workflowId})` : ''),
      );
    }

    return resolvedRoute;
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
        adapter = new OpenAIAdapter({ ...localConfig, logger: this.logger });
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
