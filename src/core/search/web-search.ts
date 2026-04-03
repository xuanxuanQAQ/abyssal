// ═══ Web Search 集成 ═══
// 通用网页搜索，支持 Tavily / SerpAPI / Bing 后端
// 纯网络 I/O，无数据库依赖

import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import type { RateLimiter } from '../infra/rate-limiter';
import { createRateLimiter } from '../infra/rate-limiter';

// ─── 类型 ───

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 仅 Tavily 返回：自动提取的页面正文片段 */
  content?: string | undefined;
}

export type WebSearchBackend = 'tavily' | 'serpapi' | 'bing';

export interface WebSearchOptions {
  /** 最大结果数（默认 5，上限 10） */
  limit?: number | undefined;
}

export interface WebSearchServiceConfig {
  backend: WebSearchBackend;
  apiKey: string;
  /** Bing mkt 参数，默认跟随系统语言 */
  market?: string | undefined;
}

const VALID_BACKENDS: ReadonlySet<string> = new Set<WebSearchBackend>(['tavily', 'serpapi', 'bing']);

// ─── WebSearchService ───

export class WebSearchService {
  private readonly http: HttpClient;
  private readonly logger: Logger;
  private readonly backend: WebSearchBackend;
  private readonly apiKey: string;
  private readonly market: string;
  private readonly limiter: RateLimiter;

  constructor(
    http: HttpClient,
    logger: Logger,
    config: WebSearchServiceConfig,
  ) {
    if (!VALID_BACKENDS.has(config.backend)) {
      throw new Error(
        `Invalid web search backend '${config.backend}', must be one of: ${[...VALID_BACKENDS].join(', ')}`,
      );
    }
    this.http = http;
    this.logger = logger;
    this.backend = config.backend;
    this.apiKey = config.apiKey;
    this.market = config.market ?? 'en-US';
    this.limiter = createRateLimiter('webSearch');
  }

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    const limit = Math.min(options?.limit ?? 5, 10);
    this.logger.debug('[WebSearch] searching', { backend: this.backend, query, limit });

    try {
      switch (this.backend) {
        case 'tavily':
          return await this.searchTavily(query, limit);
        case 'serpapi':
          return await this.searchSerpApi(query, limit);
        case 'bing':
          return await this.searchBing(query, limit);
        default:
          throw new Error(`Unknown web search backend: ${this.backend}`);
      }
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.warn('[WebSearch] search failed', { backend: this.backend, error: message });

      if (/401|403|unauthorized|forbidden/i.test(message)) {
        throw new Error(`Web search API key invalid or expired (${this.backend})`, { cause: err });
      }
      if (/timeout|timed out|abort/i.test(message)) {
        throw new Error(`Web search request timed out (${this.backend})`, { cause: err });
      }
      throw new Error(`Web search failed (${this.backend}): ${message}`, { cause: err });
    }
  }

  // ─── Tavily ───

  private async searchTavily(query: string, limit: number): Promise<WebSearchResult[]> {
    await this.limiter.acquire();

    const data = await this.http.postJson<TavilyResponse>(
      'https://api.tavily.com/search',
      {
        api_key: this.apiKey,
        query,
        max_results: limit,
        search_depth: 'basic',
        include_answer: false,
      },
    );

    return (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: truncateSnippet(r.content ?? '', 500),
      content: r.raw_content ? truncateSnippet(r.raw_content, 1000) : undefined,
    }));
  }

  // ─── SerpAPI (Google) ───

  private async searchSerpApi(query: string, limit: number): Promise<WebSearchResult[]> {
    await this.limiter.acquire();

    const params = new URLSearchParams({
      q: query,
      api_key: this.apiKey,
      engine: 'google',
      num: String(limit),
    });

    const data = await this.http.requestJson<SerpApiResponse>(
      `https://serpapi.com/search.json?${params}`,
    );

    return (data.organic_results ?? []).slice(0, limit).map((r) => ({
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: truncateSnippet(r.snippet ?? '', 500),
    }));
  }

  // ─── Bing Web Search API ───

  private async searchBing(query: string, limit: number): Promise<WebSearchResult[]> {
    await this.limiter.acquire();

    const params = new URLSearchParams({
      q: query,
      count: String(limit),
      mkt: this.market,
    });

    const data = await this.http.requestJson<BingResponse>(
      `https://api.bing.microsoft.com/v7.0/search?${params}`,
      {
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      },
    );

    return (data.webPages?.value ?? []).slice(0, limit).map((r) => ({
      title: r.name ?? '',
      url: r.url ?? '',
      snippet: truncateSnippet(r.snippet ?? '', 500),
    }));
  }
}

// ─── API 响应类型 ───

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    raw_content?: string;
  }>;
}

interface SerpApiResponse {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
  }>;
}

interface BingResponse {
  webPages?: {
    value?: Array<{
      name?: string;
      url?: string;
      snippet?: string;
    }>;
  };
}

// ─── 工具函数 ───

function truncateSnippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

// ─── 工厂函数 ───

export function createWebSearchService(
  http: HttpClient,
  logger: Logger,
  config: WebSearchServiceConfig,
): WebSearchService {
  return new WebSearchService(http, logger, config);
}
