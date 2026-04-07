// ═══ OpenAlex API 集成 ═══
// §3: search + 摘要反转索引重建

import type { PaperMetadata, PaperType } from '../types/paper';
import type { RateLimiter } from '../infra/rate-limiter';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import { RateLimitedError } from '../types/errors';
import { parseAuthorNames } from './author-name';
import { generatePaperId, normalizeDoi } from './paper-id';

// ─── 常量 ───

const BASE_URL = 'https://api.openalex.org/works';

// ─── OpenAlex 响应类型 ───

interface OAWork {
  doi?: string | undefined;
  ids?: Record<string, string | undefined> | undefined;
  title?: string | undefined;
  authorships?: Array<{
    author: { display_name: string };
  }> | undefined;
  publication_year?: number | undefined;
  abstract_inverted_index?: Record<string, number[]> | undefined;
  cited_by_count?: number | undefined;
  type?: string | undefined;
  primary_location?: {
    source?: {
      display_name?: string | undefined;
      host_organization_name?: string | undefined;
      issn_l?: string | undefined;
    } | undefined;
  } | undefined;
  biblio?: {
    volume?: string | undefined;
    issue?: string | undefined;
    first_page?: string | undefined;
    last_page?: string | undefined;
  } | undefined;
  open_access?: { oa_url?: string | undefined } | undefined;
}

interface OASearchResponse {
  meta: {
    count: number;
    next_cursor: string | null;
  };
  results: OAWork[];
}

// ─── §3.3 摘要反转索引重建 ───

export function rebuildAbstract(
  invertedIndex: Record<string, number[]> | undefined | null,
): string | null {
  if (!invertedIndex) return null;

  // 找出最大位置索引
  let maxPos = 0;
  for (const positions of Object.values(invertedIndex)) {
    for (const pos of positions) {
      if (pos > maxPos) maxPos = pos;
    }
  }

  const words = new Array<string>(maxPos + 1).fill('');

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }

  return words.filter((w) => w.length > 0).join(' ');
}

// ─── type → PaperType ───

function mapOAType(oaType: string | undefined): PaperType {
  switch (oaType) {
    case 'journal-article': return 'journal';
    case 'proceedings-article': return 'conference';
    case 'book': return 'book';
    case 'book-chapter': return 'chapter';
    case 'review': return 'review';
    case 'posted-content':
    case 'preprint': return 'preprint';
    default: return 'unknown';
  }
}

// ─── OAWork → PaperMetadata ───

function mapOAWork(work: OAWork): PaperMetadata & { _oaUrl?: string | undefined } {
  const doi = work.doi ? normalizeDoi(work.doi) : null;
  const title = work.title ?? '';

  // pmid / pmcid 提取（去 URL 前缀）
  const rawPmid = work.ids?.['pmid'] ?? null;
  const rawPmcid = work.ids?.['pmcid'] ?? null;
  const pmid = rawPmid
    ? rawPmid.replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, '').replace(/\/$/, '')
    : null;
  const pmcid = rawPmcid
    ? rawPmcid.replace(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\//, '').replace(/\/$/, '')
    : null;

  const pages =
    work.biblio?.first_page && work.biblio?.last_page
      ? `${work.biblio.first_page}-${work.biblio.last_page}`
      : work.biblio?.first_page ?? null;

  return {
    id: generatePaperId(doi, null, title),
    title,
    authors: parseAuthorNames(
      (work.authorships ?? []).map((a) => a.author.display_name),
    ),
    year: work.publication_year ?? 0,
    doi,
    arxivId: null,
    abstract: rebuildAbstract(work.abstract_inverted_index),
    citationCount: work.cited_by_count ?? null,
    paperType: mapOAType(work.type),
    source: 'openalex',
    venue: null,
    journal: work.primary_location?.source?.display_name ?? null,
    volume: work.biblio?.volume ?? null,
    issue: work.biblio?.issue ?? null,
    pages,
    publisher: work.primary_location?.source?.host_organization_name ?? null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: work.primary_location?.source?.issn_l ?? null,
    pmid,
    pmcid,
    url: null,
    bibtexKey: null,
    biblioComplete: false,
    _oaUrl: work.open_access?.oa_url,
  } as PaperMetadata & { _oaUrl?: string | undefined };
}

// ─── §3.2 searchOpenAlex ───

export interface OASearchOptions {
  limit?: number | undefined;
  yearRange?: { min?: number | undefined; max?: number | undefined } | undefined;
  minCitations?: number | undefined;
}

export async function searchOpenAlex(
  http: HttpClient,
  limiter: RateLimiter,
  email: string | null,
  logger: Logger,
  concepts: string[],
  options: OASearchOptions = {},
  apiKey?: string | null,
): Promise<PaperMetadata[]> {
  const limit = options.limit ?? 100;
  const results: PaperMetadata[] = [];

  // filter 构建
  const filters: string[] = [];

  // 文本关键词收集（用 default.search 参数传递）
  const textQueries: string[] = [];

  for (const concept of concepts) {
    if (/^C\d+$/.test(concept)) {
      // OpenAlex concept ID → 精确过滤 (concepts 已废弃，改用 topics)
      filters.push(`topics.id:${concept}`);
    } else {
      // 自由文本 → 收集到 search 参数
      textQueries.push(concept);
    }
  }

  if (options.yearRange) {
    if (options.yearRange.min != null && options.yearRange.max != null) {
      filters.push(`publication_year:${options.yearRange.min}-${options.yearRange.max}`);
    } else if (options.yearRange.min != null) {
      filters.push(`publication_year:>${options.yearRange.min - 1}`);
    } else if (options.yearRange.max != null) {
      filters.push(`publication_year:<${options.yearRange.max + 1}`);
    }
  }

  if (options.minCitations != null) {
    filters.push(`cited_by_count:>${options.minCitations}`);
  }

  const filterParam = filters.length > 0 ? filters.join(',') : null;
  const searchParam = textQueries.length > 0 ? textQueries.join(' ') : null;

  // cursor-based 分页
  let cursor: string | null = '*';

  while (cursor !== null && results.length < limit) {
    const params = new URLSearchParams({
      per_page: String(Math.min(100, limit - results.length)),
      cursor,
    });
    if (filterParam) params.set('filter', filterParam);
    if (searchParam) params.set('search', searchParam);
    if (apiKey) params.set('api_key', apiKey);
    else if (email) params.set('mailto', email);

    const url = `${BASE_URL}?${params}`;

    await limiter.acquire();
    let response: OASearchResponse;
    try {
      response = await http.requestJson<OASearchResponse>(url);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        limiter.freeze(err.retryAfterMs);
        logger.warn('OpenAlex rate limited', { retryAfterMs: err.retryAfterMs });
      }
      throw err;
    }

    for (const work of response.results) {
      if (work.title) results.push(mapOAWork(work));
    }

    cursor = response.meta.next_cursor;
  }

  return results.slice(0, limit);
}
