// ═══ Search Module — 公共接口 ═══
//
// 纯网络 I/O 模块——无数据库依赖、无 LLM 依赖。
// 全部函数无副作用（不写入数据库、不修改文件系统）。

import type { PaperMetadata } from '../types/paper';
import type { CitationDirection } from './types';
import type { AbyssalConfig } from '../types/config';
import type { PaperId } from '../types/common';
import type { Logger } from '../infra/logger';
import { RateLimiter, createRateLimiter } from '../infra/rate-limiter';
import { HttpClient } from '../infra/http-client';

import * as ss from './semantic-scholar';
import * as oa from './openalex';
import * as ax from './arxiv';
import * as gs from './google-scholar';
import * as ts from './tavily-scholar';
import { deduplicatePapers } from './dedup';
import { detectBridgePapers } from './bridge-detection';

// ─── 类型重导出 ───

export type { CitationDirection } from './types';
export type { SSSearchOptions } from './semantic-scholar';
export type { OASearchOptions } from './openalex';
export type { ArxivSearchOptions } from './arxiv';
export type { GoogleScholarSearchOptions } from './google-scholar';
export type { TavilyScholarSearchOptions } from './tavily-scholar';
export { parseAuthorName, parseAuthorNames } from './author-name';
export { generatePaperId, titleNormalize, normalizeDoi, normalizeArxivId } from './paper-id';
export { deduplicatePapers } from './dedup';
export { detectBridgePapers } from './bridge-detection';
export { rebuildAbstract } from './openalex';
export { createWebSearchService, WebSearchService } from './web-search';
export type { WebSearchResult, WebSearchBackend, WebSearchOptions, WebSearchServiceConfig } from './web-search';

// ═══ SearchService ═══

export class SearchService {
  private readonly http: HttpClient;
  private readonly logger: Logger;
  private readonly config: AbyssalConfig;

  // 速率限制器
  private readonly ssLimiter: RateLimiter;
  private readonly oaLimiter: RateLimiter;
  private readonly axLimiter: RateLimiter;
  private readonly gsLimiter: RateLimiter;
  private readonly tsLimiter: RateLimiter;

  private readonly ssApiKey: string | null;
  private readonly oaApiKey: string | null;
  private readonly oaEmail: string | null;
  private readonly webSearchApiKey: string | null;

  constructor(config: AbyssalConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    this.http = new HttpClient({
      logger,
      userAgentEmail: config.apiKeys.openalexEmail ?? undefined,
    });

    this.ssApiKey = config.apiKeys.semanticScholarApiKey ?? null;
    this.oaApiKey = config.apiKeys.openalexApiKey ?? null;
    this.oaEmail = config.apiKeys.openalexEmail ?? null;
    this.webSearchApiKey = config.apiKeys.webSearchApiKey ?? null;

    this.ssLimiter = this.ssApiKey
      ? createRateLimiter('semanticScholarWithKey')
      : createRateLimiter('semanticScholarNoKey');
    this.oaLimiter = createRateLimiter('openAlex');
    this.axLimiter = createRateLimiter('arxiv');
    this.gsLimiter = createRateLimiter('googleScholar');
    this.tsLimiter = createRateLimiter('tavilyScholar');
  }

  // ─── §2 Semantic Scholar ───

  async searchSemanticScholar(
    query: string,
    options?: ss.SSSearchOptions,
  ): Promise<PaperMetadata[]> {
    return ss.searchSemanticScholar(
      this.http, this.ssLimiter, this.ssApiKey, this.logger,
      query, options,
    );
  }

  async getPaperDetails(identifier: string): Promise<PaperMetadata> {
    return ss.getPaperDetails(
      this.http, this.ssLimiter, this.ssApiKey, this.logger,
      identifier,
    );
  }

  async getCitations(
    s2PaperId: string,
    direction: CitationDirection,
    limit?: number,
  ): Promise<PaperMetadata[]> {
    return ss.getCitations(
      this.http, this.ssLimiter, this.ssApiKey, this.logger,
      s2PaperId, direction, limit,
    );
  }

  async getRelatedPapers(s2PaperId: string): Promise<PaperMetadata[]> {
    return ss.getRelatedPapers(
      this.http, this.ssLimiter, this.ssApiKey, this.logger,
      s2PaperId,
    );
  }

  async searchByAuthor(
    authorName: string,
    affiliationHint?: string,
    limit?: number,
  ): Promise<PaperMetadata[]> {
    return ss.searchByAuthor(
      this.http, this.ssLimiter, this.ssApiKey, this.logger,
      authorName, affiliationHint, limit,
    );
  }

  // ─── §3 OpenAlex ───

  async searchOpenAlex(
    concepts: string[],
    options?: oa.OASearchOptions,
  ): Promise<PaperMetadata[]> {
    return oa.searchOpenAlex(
      this.http, this.oaLimiter, this.oaEmail, this.logger,
      concepts, options, this.oaApiKey,
    );
  }

  // ─── §4 arXiv ───

  async searchArxiv(
    query: string,
    options?: ax.ArxivSearchOptions,
  ): Promise<PaperMetadata[]> {
    return ax.searchArxiv(
      this.http, this.axLimiter, this.logger,
      query, options,
    );
  }

  // ─── §6 Google Scholar (SerpAPI) ───

  async searchGoogleScholar(
    query: string,
    options?: gs.GoogleScholarSearchOptions,
  ): Promise<PaperMetadata[]> {
    if (!this.webSearchApiKey) {
      throw new Error('SerpAPI key required for Google Scholar search (set api_keys.web_search_api_key)');
    }
    return gs.searchGoogleScholar(
      this.http, this.gsLimiter, this.webSearchApiKey, this.logger,
      query, options,
    );
  }

  // ─── §7 Tavily Scholar ───

  async searchTavilyScholar(
    query: string,
    options?: ts.TavilyScholarSearchOptions,
  ): Promise<PaperMetadata[]> {
    if (!this.webSearchApiKey) {
      throw new Error('Tavily API key required for Tavily Scholar search (set api_keys.web_search_api_key)');
    }
    return ts.searchTavilyScholar(
      this.http, this.tsLimiter, this.webSearchApiKey, this.logger,
      query, options,
    );
  }

  // ─── §5 去重 ───

  deduplicatePapers(papers: PaperMetadata[]): PaperMetadata[] {
    return deduplicatePapers(papers);
  }

  // ─── §10 桥梁论文 ───

  detectBridgePapers(
    seedIds: PaperId[],
    citationMap: Map<PaperId, PaperId[]>,
  ): Map<PaperId, number> {
    return detectBridgePapers(seedIds, citationMap);
  }
}

// ═══ 工厂函数 ═══

export function createSearchService(
  config: AbyssalConfig,
  logger: Logger,
): SearchService {
  return new SearchService(config, logger);
}
