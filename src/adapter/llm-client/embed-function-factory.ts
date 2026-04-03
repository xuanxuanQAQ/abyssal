// ═══ EmbedFunction 工厂 ═══
// 根据配置构建嵌入后端实现（OpenAI embeddings API）。
// 支持 ConfigProvider 热更新：当 rag 或 apiKeys 变化时自动重建内部 client。

import OpenAI from 'openai';
import type { EmbedFunction } from '../../core/types/common';
import type { ConfigProvider } from '../../core/infra/config-provider';
import type { Logger } from '../../core/infra/logger';
import { countTokens } from '../../core/infra/token-counter';
import { findEmbeddingModelDef } from '../../core/config/config-schema';

// ─── API 嵌入后端（OpenAI / compatible） ───

function createApiEmbedClient(
  apiKey: string,
  model: string,
  baseURL?: string,
): { client: OpenAI; model: string } {
  return {
    client: new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
    }),
    model,
  };
}

// ─── ReactiveEmbedFunction ───

/**
 * EmbedFunction wrapper that rebuilds its internal OpenAI client
 * when ConfigProvider emits changes to 'rag' or 'apiKeys'.
 */
export class ReactiveEmbedFunction implements EmbedFunction {
  private inner: { client: OpenAI; model: string } | null = null;
  private maxTokensPerText: number = 8000;
  /** Non-null when the model supports variable dimensions and needs an explicit `dimensions` param. */
  private requestDimension: number | null = null;
  private readonly logger: Logger;
  private readonly unsubscribe: () => void;

  constructor(configProvider: ConfigProvider, logger: Logger) {
    this.logger = logger;
    this.rebuild(configProvider);

    this.unsubscribe = configProvider.onChange((event) => {
      if (event.changedSections.includes('rag') || event.changedSections.includes('apiKeys')) {
        this.logger.info('Embedding config changed — rebuilding embed client');
        this.rebuild(configProvider);
      }
    });
  }

  private rebuild(configProvider: ConfigProvider): void {
    const config = configProvider.config;
    const { embeddingModel, embeddingProvider } = config.rag;

    // Derive token limit from registry; fall back to conservative default
    const modelDef = findEmbeddingModelDef(embeddingModel);
    this.maxTokensPerText = modelDef?.maxTokens ?? 512;
    this.requestDimension = modelDef?.requestDimensions ? modelDef.dimension : null;

    if (embeddingProvider === 'siliconflow') {
      const apiKey = config.apiKeys.siliconflowApiKey;
      if (!apiKey) {
        this.inner = null;
        return;
      }
      this.inner = createApiEmbedClient(apiKey, embeddingModel, 'https://api.siliconflow.cn/v1');
      return;
    }

    if (embeddingProvider === 'jina') {
      const apiKey = config.apiKeys.jinaApiKey;
      if (!apiKey) {
        this.inner = null;
        return;
      }
      this.inner = createApiEmbedClient(apiKey, embeddingModel, 'https://api.jina.ai/v1');
      return;
    }

    // Default: OpenAI
    const apiKey = config.apiKeys.openaiApiKey;
    if (!apiKey) {
      this.inner = null;
      return;
    }
    this.inner = createApiEmbedClient(apiKey, embeddingModel);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.inner) {
      throw new Error('Embed function not configured — no API key for embedding provider');
    }
    if (texts.length === 0) return [];

    // Truncate texts that exceed the embedding model's token limit.
    const limit = this.maxTokensPerText;
    const safeBatch = texts.map((t) => {
      if (countTokens(t) <= limit) return t;
      // Binary-search for the longest prefix within the limit
      let lo = 0;
      let hi = t.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (countTokens(t.slice(0, mid)) <= limit) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      this.logger.warn('Embedding input truncated', {
        originalTokens: countTokens(t),
        limit,
        truncatedChars: lo,
      });
      return t.slice(0, lo);
    });

    // Batch to avoid API limits (most providers cap at ~2048 inputs per call)
    const BATCH_SIZE = 100;
    const results: Float32Array[] = [];

    for (let i = 0; i < safeBatch.length; i += BATCH_SIZE) {
      const batch = safeBatch.slice(i, i + BATCH_SIZE);
      try {
        const response = await this.inner.client.embeddings.create({
          model: this.inner.model,
          input: batch,
          ...(this.requestDimension != null && { dimensions: this.requestDimension }),
        });
        const sorted = response.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
          results.push(new Float32Array(item.embedding));
        }
      } catch (err: unknown) {
        // Log full API error details for diagnosis
        const apiErr = err as { status?: number; error?: unknown; message?: string };
        this.logger.error('Embedding API call failed', err instanceof Error ? err : undefined, {
          model: this.inner.model,
          batchSize: batch.length,
          batchTokens: batch.map((t) => countTokens(t)),
          status: apiErr.status,
          apiError: apiErr.error,
        });
        throw err;
      }
    }

    return results;
  }

  /** Returns true if the embed function has a valid backend configured. */
  get isAvailable(): boolean {
    return this.inner !== null;
  }

  dispose(): void {
    this.unsubscribe();
  }
}

// ─── 工厂 ───

/**
 * 根据 ConfigProvider 创建响应式 EmbedFunction 实例。
 *
 * 返回 null 表示当前无法创建（缺少 API key）。
 * 即使初始时 null，后续 config 变更后可能变为可用——
 * 因此调用方应始终保留 ReactiveEmbedFunction 引用。
 */
export function createEmbedFunction(opts: {
  configProvider: ConfigProvider;
  logger: Logger;
}): ReactiveEmbedFunction {
  const fn = new ReactiveEmbedFunction(opts.configProvider, opts.logger);
  if (fn.isAvailable) {
    opts.logger.info('Embedding function initialized', {
      model: opts.configProvider.config.rag.embeddingModel,
      provider: opts.configProvider.config.rag.embeddingProvider,
    });
  } else {
    opts.logger.warn('No embedding API key configured — embedding disabled (will auto-enable on config change)');
  }
  return fn;
}
