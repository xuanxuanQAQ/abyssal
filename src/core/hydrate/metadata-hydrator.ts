// ═══ Multi-Source Metadata Hydrator ═══
// 对论文的每个 null 字段，按优先级尝试多个数据源填充。
// 遵循 fill-only 原则：已有值不覆盖。

import type { PaperMetadata } from '../types/paper';
import type { PdfEmbeddedMetadata, FirstPageMetadata } from '../process';
import type { Logger } from '../infra/logger';
import type { LlmCallFn } from './llm-metadata-extractor';
import { extractMetadataWithLlm } from './llm-metadata-extractor';

// ─── 搜索服务接口（依赖注入，避免循环依赖） ───

export interface MetadataLookupService {
  /** 通过 DOI/arXiv 等标识符获取完整元数据 */
  getPaperDetails?(identifier: string): Promise<Partial<PaperMetadata> | null>;
  /** 通过标题搜索获取元数据 */
  searchByTitle?(title: string): Promise<Partial<PaperMetadata>[]>;
}

export interface EnrichService {
  /** CrossRef DOI enrichment */
  enrichByDoi?(doi: string): Promise<Partial<PaperMetadata> | null>;
}

// ─── 水合配置 ───

export interface HydrateConfig {
  /** 启用 LLM 元数据提取 */
  enableLlmExtraction: boolean;
  /** 启用 API 元数据查询（S2/OpenAlex/CrossRef） */
  enableApiLookup: boolean;
}

// ─── 水合结果 ───

export interface HydrateFieldLog {
  field: string;
  value: unknown;
  source: string;
}

export interface HydrateResult {
  /** 被更新的字段记录 */
  fieldsUpdated: HydrateFieldLog[];
  /** 仍然缺失的字段 */
  fieldsMissing: string[];
}

export interface TitleSearchCandidateScore {
  titleScore: number;
  authorScore: number;
  yearScore: number;
  totalScore: number;
  accepted: boolean;
}

function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function titleTokenSimilarity(query: string, candidate: string): number {
  const q = normalizeTitleForMatch(query);
  const c = normalizeTitleForMatch(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  if (containsCjk(q) || containsCjk(c)) {
    const qChars = new Set([...q.replace(/\s+/g, '')]);
    const cChars = new Set([...c.replace(/\s+/g, '')]);
    const intersection = [...qChars].filter((char) => cChars.has(char)).length;
    const union = new Set([...qChars, ...cChars]).size;
    return union > 0 ? intersection / union : 0;
  }

  const qWords = new Set(q.split(' ').filter(Boolean));
  const cWords = new Set(c.split(' ').filter(Boolean));
  const intersection = [...qWords].filter((word) => cWords.has(word)).length;
  const union = new Set([...qWords, ...cWords]).size;
  return union > 0 ? intersection / union : 0;
}

function normalizeAuthorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function authorOverlapScore(expected: string[], candidate: string[]): number {
  if (expected.length === 0 || candidate.length === 0) return 0;

  const expectedSet = new Set(expected.map(normalizeAuthorName).filter(Boolean));
  const candidateSet = new Set(candidate.map(normalizeAuthorName).filter(Boolean));
  if (expectedSet.size === 0 || candidateSet.size === 0) return 0;

  let overlap = 0;
  for (const name of expectedSet) {
    for (const candidateName of candidateSet) {
      if (name === candidateName || name.includes(candidateName) || candidateName.includes(name)) {
        overlap++;
        break;
      }
    }
  }

  return overlap / Math.max(expectedSet.size, candidateSet.size);
}

function yearCompatibilityScore(expected: number | null | undefined, candidate: number | null | undefined): number {
  if (expected == null || candidate == null) return 0;
  const delta = Math.abs(expected - candidate);
  if (delta === 0) return 1;
  if (delta === 1) return 0.5;
  return 0;
}

export function scoreTitleSearchCandidate(
  query: Pick<PaperMetadata, 'title' | 'authors' | 'year'>,
  candidate: Partial<PaperMetadata>,
): TitleSearchCandidateScore {
  const titleScore = titleTokenSimilarity(query.title, candidate.title ?? '');
  const authorScore = authorOverlapScore(query.authors ?? [], candidate.authors ?? []);
  const yearScore = yearCompatibilityScore(query.year, candidate.year);
  const totalScore = titleScore * 0.75 + authorScore * 0.15 + yearScore * 0.10;
  const accepted = titleScore >= 0.97
    || (titleScore >= 0.88 && (authorScore >= 0.2 || yearScore >= 0.5))
    || (titleScore >= 0.74 && (authorScore >= 0.34 || yearScore >= 0.5));

  return {
    titleScore,
    authorScore,
    yearScore,
    totalScore,
    accepted,
  };
}

export function pickBestTitleSearchResult(
  query: Pick<PaperMetadata, 'title' | 'authors' | 'year'>,
  results: Partial<PaperMetadata>[],
): { candidate: Partial<PaperMetadata>; score: TitleSearchCandidateScore } | null {
  let best: { candidate: Partial<PaperMetadata>; score: TitleSearchCandidateScore } | null = null;

  for (const candidate of results) {
    const score = scoreTitleSearchCandidate(query, candidate);
    if (!best || score.totalScore > best.score.totalScore) {
      best = { candidate, score };
    }
  }

  if (!best || !best.score.accepted) return null;
  return best;
}

// ─── 主水合函数 ───

/**
 * 对一篇论文执行全字段水合。
 *
 * 数据源优先级（每个字段按顺序尝试，第一个非空值胜出）：
 * 1. PDF embedded metadata dict
 * 2. 首页启发式提取
 * 3. LLM 从首页文本提取
 * 4. Semantic Scholar / OpenAlex API（通过 DOI 或标题搜索）
 * 5. CrossRef API（通过 DOI）
 *
 * @param paper 当前论文元数据（可能大量为 null）
 * @param pdfMeta PDF 内嵌元数据（来自 extractText）
 * @param firstPage 首页启发式提取结果
 * @param deps 依赖服务
 * @returns 更新后的字段补丁 + 水合日志
 */
export async function hydratePaperMetadata(
  paper: PaperMetadata,
  pdfMeta: PdfEmbeddedMetadata | null,
  firstPage: FirstPageMetadata | null,
  deps: {
    llmCall: LlmCallFn | null;
    lookupService: MetadataLookupService | null;
    enrichService: EnrichService | null;
    config: HydrateConfig;
    logger: Logger;
  },
): Promise<{ patch: Partial<PaperMetadata>; result: HydrateResult }> {
  const { logger } = deps;
  const patch: Record<string, unknown> = {};
  const fieldsUpdated: HydrateFieldLog[] = [];

  // Helper: fill a field only if currently empty
  const fill = (field: string, value: unknown, source: string): boolean => {
    const current = (paper as unknown as Record<string, unknown>)[field];
    if (current !== null && current !== undefined && current !== '' &&
        !(Array.isArray(current) && current.length === 0)) {
      return false; // already has value
    }
    if (value === null || value === undefined || value === '' ||
        (Array.isArray(value) && value.length === 0)) {
      return false; // proposed value is empty
    }
    patch[field] = value;
    fieldsUpdated.push({ field, value, source });
    // Update paper in-memory so subsequent sources see the filled value
    (paper as unknown as Record<string, unknown>)[field] = value;
    return true;
  };

  // ── Source 1: PDF embedded metadata ──
  if (pdfMeta) {
    fill('title', cleanPdfTitle(pdfMeta.title), 'pdf_metadata');
    fill('abstract', pdfMeta.subject, 'pdf_metadata');
    if (pdfMeta.author) {
      const authors = parsePdfAuthors(pdfMeta.author);
      fill('authors', authors, 'pdf_metadata');
    }
    if (pdfMeta.creationDate) {
      const year = parsePdfYear(pdfMeta.creationDate);
      fill('year', year, 'pdf_metadata');
    }
  }

  // ── Source 2: First-page heuristic ──
  if (firstPage) {
    fill('title', firstPage.titleCandidate, 'firstpage_heuristic');
    if (firstPage.authorCandidates.length > 0) {
      fill('authors', firstPage.authorCandidates, 'firstpage_heuristic');
    }
  }

  // ── Source 3: LLM extraction from first page ──
  if (deps.config.enableLlmExtraction && deps.llmCall && firstPage?.firstPageText) {
    const llmMeta = await extractMetadataWithLlm(firstPage.firstPageText, deps.llmCall, logger);
    fill('title', llmMeta.title, 'llm_extraction');
    fill('authors', llmMeta.authors, 'llm_extraction');
    fill('year', llmMeta.year, 'llm_extraction');
    fill('abstract', llmMeta.abstract, 'llm_extraction');
    fill('doi', llmMeta.doi, 'llm_extraction');
    fill('paperType', llmMeta.paperType, 'llm_extraction');
    fill('journal', llmMeta.journal, 'llm_extraction');
    fill('volume', llmMeta.volume, 'llm_extraction');
    fill('issue', llmMeta.issue, 'llm_extraction');
    fill('pages', llmMeta.pages, 'llm_extraction');
    // keywords → 暂存，后续可扩展到 paper 类型
  }

  // ── Source 4: API lookup (S2/OpenAlex) by DOI or title ──
  if (deps.config.enableApiLookup && deps.lookupService) {
    let apiMeta: Partial<PaperMetadata> | null = null;

    // Try DOI lookup first
    const doi = paper.doi ?? (patch['doi'] as string | undefined);
    if (doi && deps.lookupService.getPaperDetails) {
      try {
        apiMeta = await deps.lookupService.getPaperDetails(doi);
      } catch (err) {
        logger.debug('[hydrate] S2 DOI lookup failed', { doi, error: (err as Error).message });
      }
    }

    // Fallback to title search
    const title = paper.title ?? (patch['title'] as string | undefined);
    if (!apiMeta && title && title.length > 10 && deps.lookupService.searchByTitle) {
      try {
        const results = await deps.lookupService.searchByTitle(title);
        if (results.length > 0) {
          const query = {
            title,
            authors: paper.authors ?? [],
            year: paper.year ?? null,
          };
          const best = pickBestTitleSearchResult(query, results);
          const candidateSummary = results.slice(0, 3).map((candidate) => {
            const score = scoreTitleSearchCandidate(query, candidate);
            return {
              title: candidate.title ?? null,
              year: candidate.year ?? null,
              doi: candidate.doi ?? null,
              titleScore: Number(score.titleScore.toFixed(3)),
              authorScore: Number(score.authorScore.toFixed(3)),
              yearScore: Number(score.yearScore.toFixed(3)),
              totalScore: Number(score.totalScore.toFixed(3)),
              accepted: score.accepted,
            };
          });

          if (best) {
            apiMeta = best.candidate;
            logger.info('[hydrate] Title search candidate accepted', {
              queryTitle: title,
              selectedTitle: best.candidate.title ?? null,
              titleScore: Number(best.score.titleScore.toFixed(3)),
              authorScore: Number(best.score.authorScore.toFixed(3)),
              yearScore: Number(best.score.yearScore.toFixed(3)),
              totalScore: Number(best.score.totalScore.toFixed(3)),
              candidateSummary,
            });
          } else {
            logger.warn('[hydrate] Title search rejected all candidates', {
              queryTitle: title,
              candidateCount: results.length,
              candidateSummary,
            });
          }
        }
      } catch (err) {
        logger.debug('[hydrate] S2 title search failed', { error: (err as Error).message });
      }
    }

    if (apiMeta) {
      fill('title', apiMeta.title, 'api_lookup');
      fill('authors', apiMeta.authors, 'api_lookup');
      fill('year', apiMeta.year, 'api_lookup');
      fill('abstract', apiMeta.abstract, 'api_lookup');
      fill('doi', apiMeta.doi, 'api_lookup');
      fill('arxivId', apiMeta.arxivId, 'api_lookup');
      fill('pmcid', apiMeta.pmcid, 'api_lookup');
      fill('pmid', apiMeta.pmid, 'api_lookup');
      fill('venue', apiMeta.venue, 'api_lookup');
      fill('journal', apiMeta.journal, 'api_lookup');
      fill('citationCount', apiMeta.citationCount, 'api_lookup');
      fill('paperType', apiMeta.paperType, 'api_lookup');
    }
  }

  // ── Source 5: CrossRef enrichment by DOI ──
  const finalDoi = paper.doi ?? (patch['doi'] as string | undefined);
  if (deps.config.enableApiLookup && deps.enrichService?.enrichByDoi && finalDoi) {
    try {
      const crossrefMeta = await deps.enrichService.enrichByDoi(finalDoi);
      if (crossrefMeta) {
        fill('journal', crossrefMeta.journal, 'crossref');
        fill('volume', crossrefMeta.volume, 'crossref');
        fill('issue', crossrefMeta.issue, 'crossref');
        fill('pages', crossrefMeta.pages, 'crossref');
        fill('publisher', crossrefMeta.publisher, 'crossref');
        fill('issn', crossrefMeta.issn, 'crossref');
        fill('isbn', crossrefMeta.isbn, 'crossref');
        fill('abstract', crossrefMeta.abstract, 'crossref');
        fill('authors', crossrefMeta.authors, 'crossref');
        fill('year', crossrefMeta.year, 'crossref');
        fill('paperType', crossrefMeta.paperType, 'crossref');
      }
    } catch (err) {
      logger.debug('[hydrate] CrossRef enrichment failed', { doi: finalDoi, error: (err as Error).message });
    }
  }

  // ── 计算仍缺失的关键字段 ──
  const keyFields = ['title', 'authors', 'year', 'abstract', 'doi'];
  const fieldsMissing = keyFields.filter((f) => {
    const val = (paper as unknown as Record<string, unknown>)[f] ?? patch[f];
    return val === null || val === undefined || val === '' ||
           (Array.isArray(val) && val.length === 0);
  });

  logger.info('[hydrate] Metadata hydration complete', {
    fieldsUpdated: fieldsUpdated.length,
    fieldsMissing,
    sources: [...new Set(fieldsUpdated.map((f) => f.source))],
  });

  return {
    patch: patch as Partial<PaperMetadata>,
    result: { fieldsUpdated, fieldsMissing },
  };
}

// ─── Helpers ───

/** Clean PDF title: remove common junk like "Microsoft Word - " prefix */
function cleanPdfTitle(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw.trim();
  // Remove common PDF generator prefixes
  t = t.replace(/^Microsoft Word\s*[-–—]\s*/i, '');
  t = t.replace(/^untitled$/i, '');
  t = t.replace(/\.pdf$/i, '');
  t = t.replace(/\.docx?$/i, '');
  // Too short or looks like a filename
  if (t.length < 5 || /^[A-Za-z0-9_-]+$/.test(t)) return null;
  return t;
}

/** Parse PDF "Author" field (semicolons, commas, or "and" separated) */
function parsePdfAuthors(raw: string): string[] {
  // Try semicolons first, then " and ", then commas (if not "LastName, FirstName" format)
  let parts: string[];
  if (raw.includes(';')) {
    parts = raw.split(';');
  } else if (raw.includes(' and ')) {
    parts = raw.split(/\s+and\s+/i);
  } else if ((raw.match(/,/g) ?? []).length >= 2) {
    // Multiple commas: likely "Name1, Name2, Name3" (not "LastName, FirstName" with one comma)
    parts = raw.split(',');
  } else {
    parts = [raw];
  }
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Parse PDF creation date → year */
function parsePdfYear(raw: string): number | null {
  // D:20230415120000 format
  const m = raw.match(/D:(\d{4})/);
  if (m) {
    const y = parseInt(m[1]!, 10);
    if (y >= 1900 && y <= 2100) return y;
  }
  // Plain year
  const m2 = raw.match(/\b((?:19|20)\d{2})\b/);
  if (m2) {
    const y = parseInt(m2[1]!, 10);
    if (y >= 1900 && y <= 2100) return y;
  }
  return null;
}
