// ═══ Google Scholar 搜索（通过 SerpAPI） ═══
//
// 使用 SerpAPI 的 google_scholar engine 返回结构化学术搜索结果。
// 优势：Google Scholar 对中文文献覆盖极好，返回标题/作者/期刊/年份/引用数。
// 免费额度：100 次/月。

import type { PaperMetadata, PaperType } from '../types/paper';
import type { RateLimiter } from '../infra/rate-limiter';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import { generatePaperId, normalizeDoi } from './paper-id';
import { parseAuthorNames } from './author-name';

// ─── 类型 ───

export interface GoogleScholarSearchOptions {
  limit?: number | undefined;
  yearRange?: { min?: number | undefined; max?: number | undefined } | undefined;
}

interface SerpApiScholarResponse {
  organic_results?: SerpApiScholarResult[];
  search_metadata?: { status?: string };
  error?: string;
}

interface SerpApiScholarResult {
  title?: string;
  result_id?: string;
  link?: string;
  snippet?: string;
  publication_info?: {
    summary?: string;
    authors?: Array<{ name?: string; author_id?: string }>;
  };
  inline_links?: {
    cited_by?: { total?: number; link?: string };
    related_pages_link?: string;
    versions?: { total?: number };
  };
  resources?: Array<{ title?: string; file_format?: string; link?: string }>;
}

// ─── 解析 publication_info.summary ───
// 格式通常为: "张粒子, 唐成鹏, 刘方… - 中国电机工程学报, 2021 - cnki.net"
//           "A Smith, B Jones - Nature, 2023 - nature.com"

interface ParsedPubInfo {
  authors: string[];
  journal: string | null;
  year: number | null;
}

function parsePubSummary(summary: string | undefined): ParsedPubInfo {
  if (!summary) return { authors: [], journal: null, year: null };

  const parts = summary.split(' - ');
  const result: ParsedPubInfo = { authors: [], journal: null, year: null };

  // 第一段：作者
  if (parts[0]) {
    result.authors = parts[0]
      .split(/[,，]/)
      .map((a) => a.replace(/…$/, '').trim())
      .filter((a) => a.length >= 2);
  }

  // 第二段：期刊 + 年份（如 "中国电机工程学报, 2021"）
  if (parts[1]) {
    const venueStr = parts[1]!;
    const yearMatch = venueStr.match(/((?:19|20)\d{2})/);
    if (yearMatch) result.year = parseInt(yearMatch[1]!);

    const journalMatch = venueStr.match(/^([^,，\d]+)/);
    if (journalMatch) result.journal = journalMatch[1]!.trim() || null;
  }

  return result;
}

// ─── SerpApiScholarResult → PaperMetadata ───

function mapScholarResult(r: SerpApiScholarResult): PaperMetadata {
  const title = r.title ?? '';
  const pubInfo = parsePubSummary(r.publication_info?.summary);

  // 优先使用结构化作者
  const authors =
    r.publication_info?.authors && r.publication_info.authors.length > 0
      ? r.publication_info.authors.map((a) => a.name ?? '').filter(Boolean)
      : pubInfo.authors;

  // 尝试从链接提取 DOI
  let doi: string | null = null;
  const doiMatch = (r.link ?? '').match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/);
  if (doiMatch) doi = normalizeDoi(doiMatch[1]!);

  return {
    id: generatePaperId(doi, null, title),
    title,
    authors: parseAuthorNames(authors),
    year: pubInfo.year ?? 0,
    doi,
    arxivId: null,
    abstract: r.snippet ?? null,
    citationCount: r.inline_links?.cited_by?.total ?? null,
    paperType: (pubInfo.journal ? 'journal' : 'unknown') as PaperType,
    source: 'google_scholar',
    venue: pubInfo.journal,
    journal: pubInfo.journal,
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
    url: r.link ?? null,
    bibtexKey: null,
    biblioComplete: false,
  };
}

// ─── 搜索 ───

export async function searchGoogleScholar(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string,
  logger: Logger,
  query: string,
  options: GoogleScholarSearchOptions = {},
): Promise<PaperMetadata[]> {
  const limit = options.limit ?? 10;

  const params = new URLSearchParams({
    engine: 'google_scholar',
    q: query,
    api_key: apiKey,
    num: String(Math.min(limit, 20)),
    hl: 'zh-cn',
  });

  if (options.yearRange?.min != null) {
    params.set('as_ylo', String(options.yearRange.min));
  }
  if (options.yearRange?.max != null) {
    params.set('as_yhi', String(options.yearRange.max));
  }

  const url = `https://serpapi.com/search.json?${params}`;
  logger.debug('[GoogleScholar] searching', { query, limit });

  await limiter.acquire();
  const resp = await http.requestJson<SerpApiScholarResponse>(url);

  if (resp.error) {
    logger.warn('[GoogleScholar] API error', { error: resp.error });
    throw new Error(`Google Scholar search failed: ${resp.error}`);
  }

  const results = (resp.organic_results ?? []).slice(0, limit);
  logger.info('[GoogleScholar] results', { query: query.slice(0, 60), count: results.length });

  return results.map(mapScholarResult);
}
