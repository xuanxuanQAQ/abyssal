/**
 * LlmClient — unified interface for all LLM operations.
 *
 * Five core methods: complete, completeStream, embed, describeImage, rerank.
 * Internal routing: ModelRouter → adapter → retry → normalize → CostTracker.
 *
 * Implements VisionCapable (for ProcessModule injection)
 * and EmbedFunction (for RAG injection).
 *
 * See spec: section 1 — LlmClient Unified Interface
 */

import type { AbyssalConfig } from '../../core/types/config';
import type { Logger } from '../../core/infra/logger';
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
  | { type: 'message_end'; text: string; usage: TokenUsage; finishReason: FinishReason }
  | { type: 'error'; code: string; message: string };

// ─── Adapter interface (implemented by Claude and OpenAI adapters) ───

export interface LlmAdapter {
  complete(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    workflowId?: string;
  }): Promise<CompletionResult>;

  completeStream(params: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    workflowId?: string;
  }): AsyncIterable<StreamChunk>;

  describeImage(
    imageBase64: string,
    mediaType: string,
    prompt: string,
    maxTokens: number,
    model?: string,
  ): Promise<string>;
}

// ─── Complete request params ───

export interface CompleteParams {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  workflowId?: string;
  signal?: AbortSignal;
}

// ─── LlmClient ───

export class LlmClient implements VisionCapable {
  private readonly router: ModelRouter;
  private readonly adapters: Map<string, LlmAdapter> = new Map();
  private readonly costTracker: CostTracker;
  private readonly reranker: RerankerScheduler;
  private readonly embedFn: EmbedFunction | null;
  private readonly logger: Logger;

  constructor(params: {
    config: AbyssalConfig;
    logger: Logger;
    reranker: RerankerScheduler;
    embedFn?: EmbedFunction | null;
  }) {
    this.logger = params.logger;
    this.router = new ModelRouter(params.config.llm, params.config.apiKeys);
    this.costTracker = new CostTracker();
    this.reranker = params.reranker;
    this.embedFn = params.embedFn ?? null;

    this.initAdapters(params.config);
  }

  private initAdapters(config: AbyssalConfig): void {
    const keys = config.apiKeys;

    // Claude adapter
    if (keys.anthropicApiKey) {
      this.adapters.set('anthropic', new ClaudeAdapter(keys.anthropicApiKey));
    }

    // OpenAI adapter
    if (keys.openaiApiKey) {
      this.adapters.set('openai', new OpenAIAdapter({
        apiKey: keys.openaiApiKey,
        provider: 'openai',
      }));
    }

    // DeepSeek adapter (OpenAI-compatible)
    if (keys.deepseekApiKey) {
      this.adapters.set('deepseek', new OpenAIAdapter({
        apiKey: keys.deepseekApiKey,
        baseURL: 'https://api.deepseek.com/v1',
        provider: 'deepseek',
      }));
    }

    // Ollama adapter (OpenAI-compatible, local)
    this.adapters.set('ollama', new OpenAIAdapter({
      apiKey: '',
      baseURL: 'http://localhost:11434/v1',
      provider: 'ollama',
    }));

    // vLLM adapter (OpenAI-compatible, local)
    // TODO: read vllm endpoint from config.llm.vllmEndpoint when added
    this.adapters.set('vllm', new OpenAIAdapter({
      apiKey: '',
      baseURL: 'http://localhost:8000/v1',
      provider: 'vllm',
    }));
  }

  // ─── complete (§1.1) ───

  async complete(params: CompleteParams): Promise<CompletionResult> {
    const route = this.router.resolveWithFallback(params.workflowId);
    const adapter = this.getAdapter(route);
    const startTime = Date.now();

    const result = await retryableCall(
      () => adapter.complete({
        model: route.model,
        systemPrompt: params.systemPrompt,
        messages: params.messages,
        ...(params.tools != null && { tools: params.tools }),
        ...(params.maxTokens != null && { maxTokens: params.maxTokens }),
        ...(params.temperature != null && { temperature: params.temperature }),
        ...(params.signal != null && { signal: params.signal }),
        ...(params.workflowId != null && { workflowId: params.workflowId }),
      }),
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

    // Record cost
    this.costTracker.record({
      model: route.model,
      provider: route.provider,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - startTime,
      ...(params.workflowId != null && { workflowId: params.workflowId }),
    });

    return result;
  }

  // ─── completeStream (§1.1) ───

  async *completeStream(params: CompleteParams): AsyncIterable<StreamChunk> {
    const route = this.router.resolveWithFallback(params.workflowId);
    const adapter = this.getAdapter(route);
    const startTime = Date.now();

    // Streaming does not use retry-engine (§5.5 — use timeout instead)
    const stream = adapter.completeStream({
      model: route.model,
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      ...(params.tools != null && { tools: params.tools }),
      ...(params.maxTokens != null && { maxTokens: params.maxTokens }),
      ...(params.temperature != null && { temperature: params.temperature }),
      ...(params.signal != null && { signal: params.signal }),
      ...(params.workflowId != null && { workflowId: params.workflowId }),
    });

    let firstTokenReceived = false;
    let lastChunkTime = Date.now();

    // First-token timeout: 30s; inter-token timeout: 10s (§5.5)
    const FIRST_TOKEN_TIMEOUT = 30_000;
    const INTER_TOKEN_TIMEOUT = 10_000;

    for await (const chunk of stream) {
      const now = Date.now();

      if (!firstTokenReceived && chunk.type === 'text_delta') {
        if (now - startTime > FIRST_TOKEN_TIMEOUT) {
          yield { type: 'error', code: 'FIRST_TOKEN_TIMEOUT', message: 'No response within 30s' };
          return;
        }
        firstTokenReceived = true;
      }

      if (firstTokenReceived && now - lastChunkTime > INTER_TOKEN_TIMEOUT) {
        yield { type: 'error', code: 'INTER_TOKEN_TIMEOUT', message: 'No output for 10s' };
        return;
      }

      lastChunkTime = now;

      // Record cost on message_end
      if (chunk.type === 'message_end') {
        this.costTracker.record({
          model: route.model,
          provider: route.provider,
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
          durationMs: Date.now() - startTime,
          ...(params.workflowId != null && { workflowId: params.workflowId }),
        });
      }

      yield chunk;
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
    // Route to vision model (default: claude-sonnet-4)
    const route = this.router.resolveWithFallback('vision');
    const adapter = this.getAdapter(route);

    // TODO: use config.llm.visionModel when added to config
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

  // ─── Token counting ───

  countTokens(text: string): number {
    return countTokens(text);
  }

  // ─── Model context window ───

  getContextWindow(workflowId?: string): number {
    const route = this.router.resolveWithFallback(workflowId);
    return getModelContextWindow(route.model);
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
    await this.reranker.terminate();
  }

  // ─── Internal ───

  private getAdapter(route: ModelRoute): LlmAdapter {
    const adapter = this.adapters.get(route.provider);
    if (!adapter) {
      throw new Error(
        `No adapter for provider "${route.provider}". Available: ${Array.from(this.adapters.keys()).join(', ')}`,
      );
    }
    return adapter;
  }
}

// ─── Factory ───

export interface CreateLlmClientOpts {
  config: AbyssalConfig;
  logger: Logger;
  reranker: RerankerScheduler;
  embedFn?: EmbedFunction | null;
}

export function createLlmClient(opts: CreateLlmClientOpts): LlmClient {
  return new LlmClient(opts);
}
