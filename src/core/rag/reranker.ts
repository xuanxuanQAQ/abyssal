// ═══ 双栈精排器 ═══
// §4: API (Cohere / Jina) / Local (BGE) 路由

import type { RankedChunk } from '../types/chunk';
import type { RagConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import { HttpClient } from '../infra/http-client';

// ─── Reranker 接口（供外部注入自定义实现） ───

export interface RerankFunction {
  rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<Array<{ index: number; relevanceScore: number }>>;
}

// ─── Reranker 类 ───

export class Reranker {
  private readonly backend: RagConfig['rerankerBackend'];
  private readonly logger: Logger;
  private readonly http: HttpClient;
  private readonly cohereApiKey: string | null;
  private readonly jinaApiKey: string | null;
  private readonly customRerankFn: RerankFunction | null;

  constructor(
    config: RagConfig,
    apiKeys: { cohereApiKey: string | null; jinaApiKey: string | null },
    logger: Logger,
    customRerankFn?: RerankFunction | null,
  ) {
    this.backend = config.rerankerBackend;
    this.logger = logger;
    this.http = new HttpClient({ logger });
    this.cohereApiKey = apiKeys.cohereApiKey;
    this.jinaApiKey = apiKeys.jinaApiKey;
    this.customRerankFn = customRerankFn ?? null;
  }

  /**
   * 精排候选 chunk 列表。
   * 返回按 relevanceScore 降序排列的 top-K 结果。
   */
  async rerank(
    query: string,
    candidates: RankedChunk[],
    topK: number,
  ): Promise<RankedChunk[]> {
    if (candidates.length === 0) return [];
    if (candidates.length <= topK) {
      // 候选数不超过 topK，无需精排
      return candidates;
    }

    const documents = candidates.map((c) => c.text);

    let results: Array<{ index: number; relevanceScore: number }>;

    if (this.customRerankFn) {
      results = await this.customRerankFn.rerank(query, documents, topK);
    } else if (this.backend === 'api-cohere' && this.cohereApiKey) {
      results = await this.rerankCohere(query, documents, topK);
    } else if (this.backend === 'api-jina' && this.jinaApiKey) {
      results = await this.rerankJina(query, documents, topK);
    } else {
      // §11 降级：无可用 reranker → 按向量 score 排序截断
      this.logger.warn('No reranker available, falling back to vector score ordering');
      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    // §4.5: 更新 score 为 reranker 的 relevance_score
    return results.map((r) => ({
      ...candidates[r.index]!,
      score: r.relevanceScore,
    }));
  }

  // ─── §4.2 Cohere Rerank API ───

  private async rerankCohere(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<Array<{ index: number; relevanceScore: number }>> {
    const body = JSON.stringify({
      model: 'rerank-v3.5',
      query,
      documents,
      top_n: topN,
      return_documents: false,
    });

    // HttpClient.request 当前不支持 POST body，使用原生 fetch
    const resp = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.cohereApiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = (await resp.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  }

  // ─── §4.2 Jina Reranker API ───

  private async rerankJina(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<Array<{ index: number; relevanceScore: number }>> {
    const body = JSON.stringify({
      model: 'jina-reranker-v2-base-multilingual',
      query,
      documents,
      top_n: topN,
    });

    const resp = await fetch('https://api.jina.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jinaApiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = (await resp.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  }
}
