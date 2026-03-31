/**
 * Reranker scheduler — unified interface routing to Cohere or Jina API backend.
 *
 * Graceful degradation: if reranker fails, falls back to vector score ordering.
 *
 * Supports config hot-reload: when ConfigProvider emits changes to 'rag' or
 * 'apiKeys', the internal reranker backend is rebuilt automatically.
 *
 * See spec: section 6 — Reranker Scheduler
 */

import type { RagConfig, ApiKeysConfig } from '../../core/types/config';
import type { Logger } from '../../core/infra/logger';
import type { ConfigProvider } from '../../core/infra/config-provider';
import { Reranker as CoreReranker } from '../../core/rag/reranker';
import type { RankedChunk } from '../../core/types/chunk';

// ─── Unified reranker interface ───

export interface RerankResult {
  id: string;
  score: number;
}

// ─── Reranker Scheduler ───

export class RerankerScheduler {
  private backend: RagConfig['rerankerBackend'] | 'none';
  private readonly logger: Logger;
  private coreReranker: CoreReranker | null;
  private readonly unsubscribe: (() => void) | null;

  constructor(
    configProvider: ConfigProvider,
    logger: Logger,
  ) {
    this.logger = logger;
    this.unsubscribe = null;

    const config = configProvider.config;
    this.backend = config.rag.rerankerBackend ?? 'none';
    this.coreReranker = this.buildCoreReranker(config.rag, config.apiKeys);

    // React to config changes: rebuild when rag or apiKeys change
    this.unsubscribe = configProvider.onChange((event) => {
      if (event.changedSections.includes('rag') || event.changedSections.includes('apiKeys')) {
        this.logger.info('Reranker config changed — rebuilding backend');
        this.backend = event.current.rag.rerankerBackend ?? 'none';
        this.coreReranker = this.buildCoreReranker(event.current.rag, event.current.apiKeys);
      }
    });
  }

  private buildCoreReranker(ragConfig: RagConfig, apiKeys: ApiKeysConfig): CoreReranker | null {
    const backend = ragConfig.rerankerBackend ?? 'none';
    if (backend === 'cohere' || backend === 'jina' || backend === 'siliconflow') {
      return new CoreReranker(ragConfig, {
        cohereApiKey: apiKeys.cohereApiKey,
        jinaApiKey: apiKeys.jinaApiKey,
        siliconflowApiKey: apiKeys.siliconflowApiKey,
      }, this.logger);
    }
    return null;
  }

  /**
   * Rerank candidates using the configured backend.
   *
   * Returns candidates sorted by relevance score (descending), limited to topK.
   * On failure, falls back to vector score ordering (§6.5).
   */
  async rerank(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    if (candidates.length === 0) return [];
    if (candidates.length <= topK || this.backend === 'none') {
      return candidates.slice(0, topK);
    }

    try {
      if (this.coreReranker) {
        return await this.coreReranker.rerank(query, candidates, topK);
      }
    } catch (err) {
      this.logger.warn('Reranker failed, falling back to vector score', {
        backend: this.backend,
        error: (err as Error).message,
      });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async terminate(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
    // No-op — API backends are stateless
  }
}
