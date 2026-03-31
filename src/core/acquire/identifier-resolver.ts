/**
 * IdentifierResolver — 模糊标识符解析
 *
 * 当论文缺少 DOI/arXivId/PMCID 时，通过 CrossRef 和 Semantic Scholar
 * 的标题搜索找到候选论文，再由 LLM 消歧选出最佳匹配。
 *
 * Feature 3 of LLM-enhanced acquire pipeline.
 */

import type { HttpClient } from '../infra/http-client';
import type { RateLimiter } from '../infra/rate-limiter';
import type { Logger } from '../infra/logger';

// ─── Types ───

export interface ResolveCandidate {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  source: 'crossref' | 'semantic_scholar';
}

export interface ResolveResult {
  doi: string | null;
  arxivId: string | null;
  pmcid: string | null;
  confidence: number;
  resolvedVia: 'crossref' | 'semantic_scholar' | 'deterministic' | null;
  candidatesFound: number;
}

export interface ResolveInput {
  title: string;
  authors: string[];
  year: number | null;
}

/**
 * LLM 调用函数类型。
 * 由外部注入，避免 core 层直接依赖 adapter 层的 LlmClient。
 */
export type LlmCallFn = (systemPrompt: string, userPrompt: string, workflowId: string) => Promise<string>;

// ─── Normalization ───

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1.0;

  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// ─── CrossRef Search ───

interface CrossRefItem {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  published?: { 'date-parts'?: number[][] };
  'published-print'?: { 'date-parts'?: number[][] };
}

async function searchCrossRef(
  http: HttpClient,
  limiter: RateLimiter,
  title: string,
  logger: Logger,
): Promise<ResolveCandidate[]> {
  try {
    await limiter.acquire();
    const encoded = encodeURIComponent(title);
    const url = `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=5&select=DOI,title,author,published,published-print`;
    const resp = await http.requestJson<{ message?: { items?: CrossRefItem[] } }>(url, { timeoutMs: 15000 });
    const items = resp.message?.items ?? [];

    return items
      .filter((item) => item.title?.[0])
      .map((item) => {
        const authors = (item.author ?? []).map((a) =>
          [a.family, a.given].filter(Boolean).join(', '),
        );
        const dateParts = item.published?.['date-parts']?.[0] ?? item['published-print']?.['date-parts']?.[0];
        return {
          title: item.title![0]!,
          authors,
          year: dateParts?.[0] ?? null,
          doi: item.DOI ?? null,
          arxivId: null,
          pmcid: null,
          source: 'crossref' as const,
        };
      });
  } catch (err) {
    logger.warn('[IdentifierResolver] CrossRef search failed', { error: (err as Error).message });
    return [];
  }
}

// ─── Semantic Scholar Search ───

interface S2SearchResult {
  data?: Array<{
    title?: string;
    authors?: Array<{ name?: string }>;
    year?: number;
    externalIds?: {
      DOI?: string;
      ArXiv?: string;
      PubMedCentral?: string;
    };
  }>;
}

async function searchSemanticScholar(
  http: HttpClient,
  limiter: RateLimiter,
  apiKey: string | null,
  title: string,
  logger: Logger,
): Promise<ResolveCandidate[]> {
  try {
    await limiter.acquire();
    const encoded = encodeURIComponent(title);
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=5&fields=title,authors,year,externalIds`;
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-api-key'] = apiKey;

    const resp = await http.requestJson<S2SearchResult>(url, { headers, timeoutMs: 15000 });
    const items = resp.data ?? [];

    return items
      .filter((item) => item.title)
      .map((item) => ({
        title: item.title!,
        authors: (item.authors ?? []).map((a) => a.name ?? ''),
        year: item.year ?? null,
        doi: item.externalIds?.DOI ?? null,
        arxivId: item.externalIds?.ArXiv ?? null,
        pmcid: item.externalIds?.PubMedCentral ?? null,
        source: 'semantic_scholar' as const,
      }));
  } catch (err) {
    logger.warn('[IdentifierResolver] Semantic Scholar search failed', { error: (err as Error).message });
    return [];
  }
}

// ─── Deduplication ───

function deduplicateCandidates(candidates: ResolveCandidate[]): ResolveCandidate[] {
  const seen = new Set<string>();
  const result: ResolveCandidate[] = [];
  for (const c of candidates) {
    // 按 DOI 去重，无 DOI 则按标题去重
    const key = c.doi ?? normalizeTitle(c.title);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

// ─── LLM Disambiguation ───

const SYSTEM_PROMPT = `You are an academic paper identifier resolver. Given a target paper's metadata and a list of candidate matches from CrossRef and Semantic Scholar, select the best match.

Respond with JSON only, no markdown:
{
  "bestMatchIndex": <0-based index, or -1 if no match is close enough>,
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>"
}

Rules:
- Compare title similarity, author overlap, and year match
- If titles are nearly identical and year matches, confidence should be high (>0.9)
- If only title is similar but authors differ significantly, lower confidence
- Return -1 if no candidate is a plausible match`;

function buildUserPrompt(target: ResolveInput, candidates: ResolveCandidate[]): string {
  const targetStr = [
    `Title: ${target.title}`,
    `Authors: ${target.authors.slice(0, 5).join('; ')}`,
    `Year: ${target.year ?? 'unknown'}`,
  ].join('\n');

  const candidateStrs = candidates.map((c, i) =>
    `[${i}] Title: ${c.title}\n    Authors: ${c.authors.slice(0, 3).join('; ')}\n    Year: ${c.year ?? 'unknown'}\n    DOI: ${c.doi ?? 'none'} | arXiv: ${c.arxivId ?? 'none'} | PMCID: ${c.pmcid ?? 'none'}`,
  );

  return `Target paper:\n${targetStr}\n\nCandidates:\n${candidateStrs.join('\n\n')}`;
}

// ─── Main Resolver ───

export class IdentifierResolver {
  constructor(
    private readonly http: HttpClient,
    private readonly crossrefLimiter: RateLimiter,
    private readonly s2Limiter: RateLimiter,
    private readonly s2ApiKey: string | null,
    private readonly llmCall: LlmCallFn | null,
    private readonly logger: Logger,
  ) {}

  async resolve(
    input: ResolveInput,
    confidenceThreshold: number,
  ): Promise<ResolveResult> {
    if (!input.title || input.title.length < 5) {
      this.logger.info('[IdentifierResolver] Title too short, skipping');
      return { doi: null, arxivId: null, pmcid: null, confidence: 0, resolvedVia: null, candidatesFound: 0 };
    }

    this.logger.info('[IdentifierResolver] Searching for identifiers', { title: input.title.slice(0, 80), authors: input.authors.slice(0, 2) });

    // 并行查询 CrossRef 和 S2
    const [crCandidates, s2Candidates] = await Promise.all([
      searchCrossRef(this.http, this.crossrefLimiter, input.title, this.logger),
      searchSemanticScholar(this.http, this.s2Limiter, this.s2ApiKey, input.title, this.logger),
    ]);

    const allCandidates = deduplicateCandidates([...crCandidates, ...s2Candidates]);
    this.logger.info('[IdentifierResolver] Candidates found', {
      crossref: crCandidates.length,
      s2: s2Candidates.length,
      deduplicated: allCandidates.length,
    });

    if (allCandidates.length === 0) {
      return { doi: null, arxivId: null, pmcid: null, confidence: 0, resolvedVia: null, candidatesFound: 0 };
    }

    // 确定性匹配：标题高度相似 + 年份匹配 → 跳过 LLM
    for (const c of allCandidates) {
      const sim = titleSimilarity(input.title, c.title);
      const yearMatch = input.year == null || c.year == null || input.year === c.year;
      if (sim >= 0.9 && yearMatch && (c.doi || c.arxivId || c.pmcid)) {
        this.logger.info('[IdentifierResolver] Deterministic match found', {
          similarity: sim.toFixed(2),
          doi: c.doi,
          arxivId: c.arxivId,
          source: c.source,
        });
        return {
          doi: c.doi,
          arxivId: c.arxivId,
          pmcid: c.pmcid,
          confidence: sim,
          resolvedVia: 'deterministic',
          candidatesFound: allCandidates.length,
        };
      }
    }

    // LLM 消歧
    if (!this.llmCall) {
      this.logger.info('[IdentifierResolver] No LLM available, using best candidate by title similarity');
      return this.pickBestByTitleSimilarity(input, allCandidates, confidenceThreshold);
    }

    try {
      const userPrompt = buildUserPrompt(input, allCandidates);
      const raw = await this.llmCall(SYSTEM_PROMPT, userPrompt, 'acquire_resolve');
      const parsed = this.parseLlmResponse(raw, allCandidates.length);

      if (parsed.bestMatchIndex < 0 || parsed.confidence < confidenceThreshold) {
        this.logger.info('[IdentifierResolver] LLM found no confident match', {
          bestMatchIndex: parsed.bestMatchIndex,
          confidence: parsed.confidence,
          threshold: confidenceThreshold,
          reasoning: parsed.reasoning,
        });
        return { doi: null, arxivId: null, pmcid: null, confidence: parsed.confidence, resolvedVia: null, candidatesFound: allCandidates.length };
      }

      const best = allCandidates[parsed.bestMatchIndex]!;
      this.logger.info('[IdentifierResolver] LLM resolved identifiers', {
        confidence: parsed.confidence,
        doi: best.doi,
        arxivId: best.arxivId,
        reasoning: parsed.reasoning,
        source: best.source,
      });

      return {
        doi: best.doi,
        arxivId: best.arxivId,
        pmcid: best.pmcid,
        confidence: parsed.confidence,
        resolvedVia: best.source,
        candidatesFound: allCandidates.length,
      };
    } catch (err) {
      this.logger.warn('[IdentifierResolver] LLM call failed, falling back to title similarity', { error: (err as Error).message });
      return this.pickBestByTitleSimilarity(input, allCandidates, confidenceThreshold);
    }
  }

  private pickBestByTitleSimilarity(
    input: ResolveInput,
    candidates: ResolveCandidate[],
    confidenceThreshold: number,
  ): ResolveResult {
    let bestSim = 0;
    let bestCandidate: ResolveCandidate | null = null;
    for (const c of candidates) {
      const sim = titleSimilarity(input.title, c.title);
      if (sim > bestSim && (c.doi || c.arxivId || c.pmcid)) {
        bestSim = sim;
        bestCandidate = c;
      }
    }
    if (bestCandidate && bestSim >= confidenceThreshold) {
      return {
        doi: bestCandidate.doi,
        arxivId: bestCandidate.arxivId,
        pmcid: bestCandidate.pmcid,
        confidence: bestSim,
        resolvedVia: bestCandidate.source,
        candidatesFound: candidates.length,
      };
    }
    return { doi: null, arxivId: null, pmcid: null, confidence: bestSim, resolvedVia: null, candidatesFound: candidates.length };
  }

  private parseLlmResponse(raw: string, maxIndex: number): { bestMatchIndex: number; confidence: number; reasoning: string } {
    try {
      // 提取 JSON（可能被 markdown 包裹）
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in LLM response');
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const idx = typeof parsed['bestMatchIndex'] === 'number' ? parsed['bestMatchIndex'] as number : -1;
      const conf = typeof parsed['confidence'] === 'number' ? parsed['confidence'] as number : 0;
      const reasoning = typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] as string : '';
      return {
        bestMatchIndex: idx >= 0 && idx < maxIndex ? idx : -1,
        confidence: Math.max(0, Math.min(1, conf)),
        reasoning,
      };
    } catch {
      return { bestMatchIndex: -1, confidence: 0, reasoning: 'Failed to parse LLM response' };
    }
  }
}
