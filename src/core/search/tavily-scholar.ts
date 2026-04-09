// ═══ Tavily Scholar 搜索 ═══
//
// 使用 Tavily 的 advanced search 模式进行学术文献搜索。
// 不限定域名，search_depth: "advanced" 提取更丰富的页面内容。
// 从返回的网页结果中解析结构化元数据（标题/作者/期刊/年份/DOI）。

import type { PaperMetadata, PaperType } from '../types/paper';
import type { RateLimiter } from '../infra/rate-limiter';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import { generatePaperId, normalizeDoi } from './paper-id';
import { parseAuthorNames } from './author-name';

// ─── 类型 ───

export interface TavilyScholarSearchOptions {
  limit?: number | undefined;
}

interface TavilySearchResponse {
  results?: TavilyResult[];
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
}

// ─── 从 Tavily 结果中提取结构化元数据 ───

function extractMetadata(r: TavilyResult): PaperMetadata {
  const rawTitle = r.title ?? '';
  const text = `${rawTitle} ${r.content ?? ''} ${r.raw_content ?? ''}`;

  // 清洗标题：去除来源后缀（"知网", "万方", "百度学术", "维普"）
  let title = rawTitle
    .replace(/\s*[-_|–—]\s*(知网|万方|百度学术|维普|CNKI|Wanfang).*$/i, '')
    .replace(/^\s*\[PDF\]\s*/i, '')
    .trim();
  if (!title) title = rawTitle;

  // DOI
  let doi: string | null = null;
  const doiMatch = text.match(/(?:doi|DOI)[:\s]*(10\.\d{4,}\/[^\s,;，；<"']+)/);
  if (doiMatch) doi = normalizeDoi(doiMatch[1]!);

  // 期刊: 《...》
  let journal: string | null = null;
  const journalMatch = text.match(/《([^》]+)》/);
  if (journalMatch) journal = journalMatch[1]!;

  // 年份
  let year: number | null = null;
  const yearMatch = text.match(/((?:19|20)\d{2})/);
  if (yearMatch) year = parseInt(yearMatch[1]!);

  // 作者: "作者：xxx, yyy" 或 "作\u3000者：xxx" 等模式
  let authors: string[] = [];
  const authorMatch = text.match(/(?:作者|作\u3000者|Author)[：:]\s*([^\n。.]+)/i);
  if (authorMatch) {
    authors = authorMatch[1]!
      .split(/[,，;；\s]+/)
      .map((a) => a.trim())
      .filter((a) => a.length >= 2)
      .slice(0, 8);
  }

  // 摘要: 取 content 前 300 字符
  const abstract = r.content ? r.content.slice(0, 300).trim() : null;

  return {
    id: generatePaperId(doi, null, title),
    title,
    authors: parseAuthorNames(authors),
    year: year ?? 0,
    doi,
    arxivId: null,
    abstract,
    citationCount: null,
    paperType: (journal ? 'journal' : 'unknown') as PaperType,
    source: 'tavily_scholar',
    venue: journal,
    journal,
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
    url: r.url ?? null,
    bibtexKey: null,
    biblioComplete: false,
  };
}

// ─── 搜索 ───

export async function searchTavilyScholar(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string,
  logger: Logger,
  query: string,
  options: TavilyScholarSearchOptions = {},
): Promise<PaperMetadata[]> {
  const limit = Math.min(options.limit ?? 10, 20);

  logger.debug('[TavilyScholar] searching', { query, limit });
  await limiter.acquire();

  const resp = await http.postJson<TavilySearchResponse>(
    'https://api.tavily.com/search',
    {
      api_key: apiKey,
      query: `${query} 论文`,
      max_results: limit,
      search_depth: 'advanced',
      include_answer: false,
    },
  );

  const results = (resp.results ?? []).slice(0, limit);
  logger.info('[TavilyScholar] results', { query: query.slice(0, 60), count: results.length });

  return results.map(extractMetadata);
}
