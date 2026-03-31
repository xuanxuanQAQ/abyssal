// ═══ 双栈精排器 ═══
// §4: API (Cohere / Jina / SiliconFlow) 路由

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

// ─── API 后端配置 ───

interface RerankApiConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

// ─── Reranker 类 ───

export class Reranker {
  private readonly backend: RagConfig['rerankerBackend'];
  private readonly logger: Logger;
  private readonly http: HttpClient;
  private readonly cohereApiKey: string | null;
  private readonly jinaApiKey: string | null;
  private readonly siliconflowApiKey: string | null;
  private readonly rerankerModel: string | null;
  private readonly customRerankFn: RerankFunction | null;

  constructor(
    config: RagConfig,
    apiKeys: { cohereApiKey: string | null; jinaApiKey: string | null; siliconflowApiKey: string | null },
    logger: Logger,
    customRerankFn?: RerankFunction | null,
  ) {
    this.backend = config.rerankerBackend;
    this.rerankerModel = config.rerankerModel;
    this.logger = logger;
    this.http = new HttpClient({ logger });
    this.cohereApiKey = apiKeys.cohereApiKey;
    this.jinaApiKey = apiKeys.jinaApiKey;
    this.siliconflowApiKey = apiKeys.siliconflowApiKey;
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

    // Fix #14: 截断超长 document（reranker API 通常限制 ~4096 tokens ≈ ~16000 chars）
    const MAX_DOC_CHARS = 16000;
    const documents = candidates.map((c) =>
      c.text.length > MAX_DOC_CHARS ? c.text.slice(0, MAX_DOC_CHARS) : c.text,
    );

    let results: Array<{ index: number; relevanceScore: number }>;

    try {
    if (this.customRerankFn) {
      results = await this.customRerankFn.rerank(query, documents, topK);
    } else {
      const apiConfig = this.resolveApiConfig();
      if (apiConfig) {
        results = await this.rerankViaApi(apiConfig, query, documents, topK);
      } else {
        // §11 降级：无可用 reranker → 按向量 score 排序截断
        this.logger.warn('No reranker available, falling back to vector score ordering');
        return candidates
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      }
    }

    // §4.5: 更新 score 为 reranker 的 relevance_score（带边界检查）
    return results
      .filter((r) => r.index >= 0 && r.index < candidates.length)
      .map((r) => ({
        ...candidates[r.index]!,
        score: r.relevanceScore,
      }));
    } catch (err) {
      // API 失败时优雅降级到向量 score 排序
      this.logger.warn('Reranker API failed, falling back to vector score ordering', {
        error: (err as Error).message,
      });
      return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }
  }

  // ─── 解析当前后端的 API 配置 ───

  private resolveApiConfig(): RerankApiConfig | null {
    if (this.backend === 'cohere' && this.cohereApiKey) {
      return {
        endpoint: 'https://api.cohere.com/v1/rerank',
        apiKey: this.cohereApiKey,
        model: 'rerank-v3.5',
      };
    }
    if (this.backend === 'jina' && this.jinaApiKey) {
      return {
        endpoint: 'https://api.jina.ai/v1/rerank',
        apiKey: this.jinaApiKey,
        model: 'jina-reranker-v2-base-multilingual',
      };
    }
    if (this.backend === 'siliconflow' && this.siliconflowApiKey) {
      return {
        endpoint: 'https://api.siliconflow.cn/v1/rerank',
        apiKey: this.siliconflowApiKey,
        model: this.rerankerModel ?? 'BAAI/bge-reranker-v2-m3',
      };
    }
    return null;
  }

  // ─── 通用 Rerank API 调用 ───
  // Cohere / Jina / SiliconFlow 均使用兼容的请求/响应格式

  private async rerankViaApi(
    apiConfig: RerankApiConfig,
    query: string,
    documents: string[],
    topN: number,
  ): Promise<Array<{ index: number; relevanceScore: number }>> {
    const body = JSON.stringify({
      model: apiConfig.model,
      query,
      documents,
      top_n: topN,
      return_documents: false,
    });

    // Fix #13: 为 reranker API 请求设置超时（30s）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let resp: Response;
    try {
      resp = await fetch(apiConfig.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      this.logger.warn('Rerank API error', {
        backend: this.backend,
        status: resp.status,
        body: errText.slice(0, 200),
      });
      throw new Error(`Rerank API failed (${this.backend}): ${resp.status}`);
    }

    const data = (await resp.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    return data.results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevance_score,
    }));
  }
}
