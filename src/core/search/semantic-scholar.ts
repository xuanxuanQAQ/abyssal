// ═══ Semantic Scholar API 集成 ═══
// §2: search / details / citations / related / author

import type { PaperMetadata, PaperType } from '../types/paper';
import type { CitationDirection } from '../types';
import type { RateLimiter } from '../infra/rate-limiter';
import { DEFAULT_BACKOFF_MS } from '../infra/rate-limiter';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import { PaperNotFoundError, ApiError, RateLimitedError } from '../types/errors';
import { parseAuthorNames } from './author-name';
import { generatePaperId, normalizeDoi, normalizeArxivId } from './paper-id';

// ─── 常量 ───

const BASE_URL = 'https://api.semanticscholar.org/graph/v1';
const REC_URL = 'https://api.semanticscholar.org/recommendations/v1';

const SEARCH_FIELDS = [
  'paperId', 'externalIds', 'title', 'authors', 'year', 'abstract',
  'venue', 'citationCount', 'publicationTypes', 'journal',
  'openAccessPdf', 'publicationDate',
].join(',');

const DETAIL_FIELDS = SEARCH_FIELDS +
  ',references.paperId,references.title,references.year,references.externalIds,tldr';

const AUTHOR_PAPER_FIELDS = SEARCH_FIELDS;

// ─── 类型（S2 API 响应） ───

interface S2Paper {
  paperId: string;
  externalIds?: Record<string, string | undefined> | undefined;
  title?: string | undefined;
  authors?: Array<{ authorId?: string | undefined; name: string }> | undefined;
  year?: number | undefined;
  abstract?: string | undefined;
  venue?: string | undefined;
  citationCount?: number | undefined;
  publicationTypes?: string[] | undefined;
  journal?: { name?: string | undefined; volume?: string | undefined; pages?: string | undefined } | undefined;
  openAccessPdf?: { url: string } | undefined;
}

interface S2SearchResponse {
  total: number;
  offset: number;
  next?: number | undefined;
  data: S2Paper[];
}

interface S2CitationEntry {
  citedPaper?: S2Paper | undefined;
  citingPaper?: S2Paper | undefined;
}

interface S2AuthorSearchResponse {
  data: Array<{
    authorId: string;
    name: string;
    paperCount?: number | undefined;
    affiliations?: string[] | undefined;
  }>;
}

interface S2AuthorPapersResponse {
  data: S2Paper[];
  offset: number;
  next?: number | undefined;
}

// ─── publicationTypes → PaperType 映射 ───

const PUB_TYPE_PRIORITY: [string, PaperType][] = [
  ['JournalArticle', 'journal'],
  ['Conference', 'conference'],
  ['Book', 'book'],
  ['BookSection', 'chapter'],
  ['Review', 'review'],
];

function mapPaperType(pubTypes: string[] | undefined): PaperType {
  if (!pubTypes || pubTypes.length === 0) return 'unknown';
  for (const [s2Type, paperType] of PUB_TYPE_PRIORITY) {
    if (pubTypes.includes(s2Type)) return paperType;
  }
  return 'unknown';
}

// ─── S2Paper → PaperMetadata ───

function mapS2Paper(s2: S2Paper, oaUrl?: string | undefined): PaperMetadata & { _oaUrl?: string | undefined } {
  const extIds = s2.externalIds ?? {};
  const doi = extIds['DOI'] ? normalizeDoi(extIds['DOI']) : null;
  const arxivId = extIds['ArXiv'] ? normalizeArxivId(extIds['ArXiv']) : null;
  const title = s2.title ?? '';

  return {
    id: generatePaperId(doi, arxivId, title),
    title,
    authors: parseAuthorNames(
      (s2.authors ?? []).map((a) => a.name),
    ),
    year: s2.year ?? 0,
    doi,
    arxivId,
    abstract: s2.abstract ?? null,
    citationCount: s2.citationCount ?? null,
    paperType: mapPaperType(s2.publicationTypes),
    source: 'semantic_scholar',
    venue: s2.venue ?? null,
    journal: s2.journal?.name ?? null,
    volume: s2.journal?.volume ?? null,
    issue: null,
    pages: s2.journal?.pages ?? null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: extIds['PubMed'] ?? null,
    pmcid: extIds['PubMedCentral'] ?? null,
    url: null,
    bibtexKey: null,
    biblioComplete: false,
    _oaUrl: s2.openAccessPdf?.url ?? oaUrl,
  } as PaperMetadata & { _oaUrl?: string | undefined };
}

// ─── 请求辅助 ───

function buildHeaders(apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

async function s2Request<T>(
  http: HttpClient,
  limiter: RateLimiter,
  url: string,
  apiKey: string | null,
  logger: Logger,
): Promise<T> {
  await limiter.acquire();
  try {
    return await http.requestJson<T>(url, {
      headers: buildHeaders(apiKey),
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      limiter.freeze(err.retryAfterMs);
      logger.warn('S2 rate limited, freezing', {
        retryAfterMs: err.retryAfterMs,
      });
    }
    throw err;
  }
}

// ─── §2.2 searchSemanticScholar ───

export interface SSSearchOptions {
  limit?: number | undefined;
  yearRange?: { min?: number | undefined; max?: number | undefined } | undefined;
  fieldsOfStudy?: string[] | undefined;
  openAccessOnly?: boolean | undefined;
}

export async function searchSemanticScholar(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  logger: Logger,
  query: string,
  options: SSSearchOptions = {},
): Promise<PaperMetadata[]> {
  const limit = options.limit ?? 100;
  const results: PaperMetadata[] = [];
  let offset = 0;

  while (offset < limit) {
    const pageSize = Math.min(100, limit - offset);
    const params = new URLSearchParams({
      query,
      offset: String(offset),
      limit: String(pageSize),
      fields: SEARCH_FIELDS,
    });

    if (options.yearRange) {
      const parts: string[] = [];
      if (options.yearRange.min != null) parts.push(String(options.yearRange.min));
      else parts.push('');
      parts.push('-');
      if (options.yearRange.max != null) parts.push(String(options.yearRange.max));
      else parts.push('');
      params.set('year', parts.join(''));
    }

    if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
      params.set('fieldsOfStudy', options.fieldsOfStudy.join(','));
    }

    const url = `${BASE_URL}/paper/search?${params}`;
    const response = await s2Request<S2SearchResponse>(
      http, limiter, url, apiKey, logger,
    );

    for (const paper of response.data) {
      results.push(mapS2Paper(paper));
    }

    if (response.next === undefined || response.next === null) break;
    offset = response.next;
  }

  const final = results.slice(0, limit);

  if (options.openAccessOnly) {
    return final.filter(
      (p) => (p as PaperMetadata & { _oaUrl?: string })._oaUrl != null,
    );
  }

  return final;
}

// ─── §2.3 getPaperDetails ───

const DOI_RE = /\//;
const ARXIV_RE = /^\d{4}\.\d{4,5}$/;
const S2_ID_RE = /^[0-9a-f]{40}$/i;

function detectIdPrefix(identifier: string): string {
  if (DOI_RE.test(identifier) && !ARXIV_RE.test(identifier)) return 'DOI:';
  if (ARXIV_RE.test(identifier)) return 'ARXIV:';
  if (S2_ID_RE.test(identifier)) return '';
  // 尝试作为 DOI
  return 'DOI:';
}

export async function getPaperDetails(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  logger: Logger,
  identifier: string,
): Promise<PaperMetadata> {
  const prefix = detectIdPrefix(identifier);
  const url = `${BASE_URL}/paper/${prefix}${encodeURIComponent(identifier)}?fields=${DETAIL_FIELDS}`;

  try {
    const paper = await s2Request<S2Paper>(http, limiter, url, apiKey, logger);
    return mapS2Paper(paper);
  } catch (err) {
    if (err instanceof ApiError || (err as { code?: string }).code === 'PAPER_NOT_FOUND') {
      throw new PaperNotFoundError({
        message: `Paper not found: ${identifier}`,
        context: { identifier },
        cause: err as Error,
      });
    }
    throw err;
  }
}

// ─── §2.4 getCitations ───

export async function getCitations(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  logger: Logger,
  s2PaperId: string,
  direction: CitationDirection,
  limit: number = 500,
): Promise<PaperMetadata[]> {
  const endpoint = direction === 'references' ? 'references' : 'citations';
  const results: PaperMetadata[] = [];
  let offset = 0;

  while (offset < limit) {
    const pageSize = Math.min(500, limit - offset);
    const url = `${BASE_URL}/paper/${s2PaperId}/${endpoint}?offset=${offset}&limit=${pageSize}&fields=${SEARCH_FIELDS}`;
    const response = await s2Request<{
      data: S2CitationEntry[];
      next?: number | undefined;
    }>(http, limiter, url, apiKey, logger);

    for (const entry of response.data) {
      const paper = direction === 'references' ? entry.citedPaper : entry.citingPaper;
      if (paper?.title) {
        results.push(mapS2Paper(paper));
      }
    }

    if (response.next === undefined || response.next === null) break;
    offset = response.next;
  }

  return results.slice(0, limit);
}

// ─── §2.5 getRelatedPapers ───

export async function getRelatedPapers(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  logger: Logger,
  s2PaperId: string,
): Promise<PaperMetadata[]> {
  const url = `${REC_URL}/papers/forpaper/${s2PaperId}`;
  const response = await s2Request<{ recommendedPapers: S2Paper[] }>(
    http, limiter, url, apiKey, logger,
  );
  return (response.recommendedPapers ?? []).map((p) => mapS2Paper(p));
}

// ─── §9 searchByAuthor ───

export async function searchByAuthor(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  logger: Logger,
  authorName: string,
  affiliationHint?: string | undefined,
  limit: number = 500,
): Promise<PaperMetadata[]> {
  // 步骤 1：作者搜索
  const searchUrl = `${BASE_URL}/author/search?query=${encodeURIComponent(authorName)}&limit=5`;
  const authorResults = await s2Request<S2AuthorSearchResponse>(
    http, limiter, searchUrl, apiKey, logger,
  );

  if (authorResults.data.length === 0) return [];

  // 选择最佳匹配
  let bestAuthor = authorResults.data[0]!;
  if (affiliationHint) {
    const hintLower = affiliationHint.toLowerCase();
    const withAffiliation = authorResults.data.find((a) =>
      a.affiliations?.some((aff) => aff.toLowerCase().includes(hintLower)),
    );
    if (withAffiliation) bestAuthor = withAffiliation;
  } else {
    // 取 paperCount 最高的
    for (const author of authorResults.data) {
      if ((author.paperCount ?? 0) > (bestAuthor.paperCount ?? 0)) {
        bestAuthor = author;
      }
    }
  }

  // 步骤 2：获取论文列表
  const results: PaperMetadata[] = [];
  let offset = 0;

  while (offset < limit) {
    const pageSize = Math.min(500, limit - offset);
    const url = `${BASE_URL}/author/${bestAuthor.authorId}/papers?offset=${offset}&limit=${pageSize}&fields=${AUTHOR_PAPER_FIELDS}`;
    const response = await s2Request<S2AuthorPapersResponse>(
      http, limiter, url, apiKey, logger,
    );

    for (const paper of response.data) {
      if (paper.title) results.push(mapS2Paper(paper));
    }

    if (response.next === undefined || response.next === null) break;
    offset = response.next;
  }

  return results.slice(0, limit);
}
