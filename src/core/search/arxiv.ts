// ═══ arXiv API 集成 ═══
// §4: search + Atom XML 解析

import { XMLParser } from 'fast-xml-parser';
import type { PaperMetadata } from '../types/paper';
import type { RateLimiter } from '../infra/rate-limiter';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import { RateLimitedError } from '../types/errors';
import { parseAuthorNames } from './author-name';
import { generatePaperId, normalizeArxivId } from './paper-id';

// ─── 常量 ───

// 注意：arXiv API 使用 HTTP（非 HTTPS）
const BASE_URL = 'http://export.arxiv.org/api/query';

// ─── XML 解析器配置 (§4.3) ───

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) =>
    ['entry', 'author', 'category', 'link'].includes(name),
  trimValues: true,
});

// ─── Atom XML 类型 ───

interface ArxivEntry {
  id: string; // URL 格式 http://arxiv.org/abs/...
  title: string;
  author?: Array<{ name: string }> | undefined;
  published: string;
  summary?: string | undefined;
  category?: Array<{ '@_term': string }> | undefined;
  link?: Array<{ '@_href': string; '@_title'?: string | undefined }> | undefined;
  doi?: string | undefined;
}

interface ArxivFeed {
  feed: {
    entry?: ArxivEntry[] | undefined;
    'opensearch:totalResults'?: { '#text'?: number | undefined } | number | undefined;
  };
}

// ─── arXiv ID 提取 (§4.3) ───

function extractArxivId(idUrl: string): string {
  // http://arxiv.org/abs/2301.12345v2 → 2301.12345
  const parts = idUrl.split('/');
  const lastPart = parts[parts.length - 1] ?? idUrl;
  // 旧格式可能含子路径: hep-th/9901001v1
  const withSubject = parts.slice(-2).join('/');
  const raw = withSubject.includes('abs/') ? lastPart : withSubject;
  return normalizeArxivId(raw);
}

// ─── ArxivEntry → PaperMetadata ───

function mapArxivEntry(entry: ArxivEntry): PaperMetadata & { _pdfUrl?: string | undefined } {
  const arxivId = extractArxivId(entry.id);
  const doi = entry.doi ? entry.doi.trim() : null;
  const title = (entry.title ?? '').replace(/\s+/g, ' ').trim();

  const pdfLink = entry.link?.find((l) => l['@_title'] === 'pdf');
  const _pdfUrl = pdfLink?.['@_href'] ?? null;

  return {
    id: generatePaperId(doi, arxivId, title),
    title,
    authors: parseAuthorNames(
      (entry.author ?? []).map((a) => a.name),
    ),
    year: new Date(entry.published).getFullYear(),
    doi,
    arxivId,
    abstract: entry.summary
      ? entry.summary.replace(/\s+/g, ' ').trim()
      : null,
    citationCount: null,
    paperType: 'preprint',
    source: 'arxiv',
    venue: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: null,
    bibtexKey: null,
    biblioComplete: false,
    _pdfUrl,
  } as PaperMetadata & { _pdfUrl?: string | undefined };
}

// ─── §4.2 searchArxiv ───

export interface ArxivSearchOptions {
  limit?: number | undefined;
  categories?: string[] | undefined;
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate' | undefined;
}

export async function searchArxiv(
  http: HttpClient,
  limiter: RateLimiter,
  logger: Logger,
  query: string,
  options: ArxivSearchOptions = {},
): Promise<PaperMetadata[]> {
  const limit = options.limit ?? 100;
  const results: PaperMetadata[] = [];

  // search_query 构建
  let searchQuery: string;
  if (/^(ti|au|abs|cat|all):/.test(query)) {
    searchQuery = query;
  } else {
    searchQuery = `all:${query}`;
  }

  if (options.categories) {
    for (const cat of options.categories) {
      searchQuery += ` AND cat:${cat}`;
    }
  }

  const sortBy = options.sortBy ?? 'relevance';
  let offset = 0;

  while (offset < limit) {
    const pageSize = Math.min(100, limit - offset);
    const params = new URLSearchParams({
      search_query: searchQuery,
      start: String(offset),
      max_results: String(pageSize),
      sortBy,
    });

    const url = `${BASE_URL}?${params}`;

    await limiter.acquire();
    let response: string;
    try {
      const resp = await http.request(url);
      response = resp.body;
    } catch (err) {
      if (err instanceof RateLimitedError) {
        limiter.freeze(err.retryAfterMs);
        logger.warn('arXiv rate limited', { retryAfterMs: err.retryAfterMs });
      }
      throw err;
    }

    // 解析 Atom XML
    const parsed = xmlParser.parse(response) as ArxivFeed;
    const entries = parsed.feed?.entry ?? [];

    if (entries.length === 0) break;

    for (const entry of entries) {
      if (entry.title) {
        results.push(mapArxivEntry(entry));
      }
    }

    if (entries.length < pageSize) break;
    offset += entries.length;
  }

  return results.slice(0, limit);
}
