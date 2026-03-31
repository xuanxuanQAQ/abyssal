// ═══ LLM 元数据提取器 ═══
// 从 PDF 首页文本中提取结构化元数据（标题、作者、摘要、年份、关键词等）

import type { Logger } from '../infra/logger';

// ─── LLM 调用接口（依赖注入） ───

export type LlmCallFn = (
  systemPrompt: string,
  userPrompt: string,
  workflowId: string,
) => Promise<string>;

// ─── 提取结果 ───

export interface LlmExtractedMetadata {
  title: string | null;
  authors: string[];         // "LastName, FirstName" 格式
  year: number | null;
  abstract: string | null;
  keywords: string[];
  doi: string | null;
  paperType: string | null;  // journal|conference|preprint|book|review|unknown
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
}

// ─── System prompt ───

const SYSTEM_PROMPT = `You are a metadata extraction engine for academic papers.
Given the first page text of a PDF, extract structured metadata.

Respond with JSON only (no markdown fences):
{
  "title": "Full paper title (null if not identifiable)",
  "authors": ["LastName, FirstName", ...],
  "year": 2024,
  "abstract": "Full abstract text (null if not on first page)",
  "keywords": ["keyword1", "keyword2"],
  "doi": "10.xxxx/yyyy (null if not found)",
  "paperType": "journal|conference|preprint|book|review|unknown",
  "journal": "Journal or conference name (null if not found)",
  "volume": "volume number (null if not found)",
  "issue": "issue number (null if not found)",
  "pages": "page range (null if not found)"
}

Rules:
- Extract ONLY what is explicitly present in the text. Do NOT guess or hallucinate.
- Authors should be in "LastName, FirstName" format. For Chinese names, use the full name as-is.
- If the text contains both Chinese and English titles, prefer the English title for "title" field.
- Year should be a 4-digit number from publication date, copyright notice, or submission/acceptance date.
- For DOI, look for patterns like "doi:10.xxxx" or "https://doi.org/10.xxxx".
- Keywords may appear after "Keywords:", "Key words:", "关键词" etc.
- If a field is not identifiable from the text, use null (for strings/numbers) or [] (for arrays).`;

// ─── 提取函数 ───

export async function extractMetadataWithLlm(
  firstPageText: string,
  llmCall: LlmCallFn,
  logger: Logger,
): Promise<LlmExtractedMetadata> {
  const userPrompt = `Extract metadata from this PDF first page text:\n\n${firstPageText.slice(0, 3000)}`;

  try {
    const raw = await llmCall(SYSTEM_PROMPT, userPrompt, 'hydrate-metadata');
    const parsed = parseResponse(raw);
    logger.debug('[LlmMetadataExtractor] Extracted metadata', {
      title: parsed.title?.slice(0, 60),
      authorCount: parsed.authors.length,
      year: parsed.year,
      hasDoi: !!parsed.doi,
      hasAbstract: !!parsed.abstract,
      keywordCount: parsed.keywords.length,
    });
    return parsed;
  } catch (err) {
    logger.warn('[LlmMetadataExtractor] Extraction failed', { error: (err as Error).message });
    return emptyResult();
  }
}

// ─── Response 解析 ───

function parseResponse(raw: string): LlmExtractedMetadata {
  // Strip markdown code fences if present
  let json = raw.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    const obj = JSON.parse(json);
    return {
      title: typeof obj.title === 'string' ? obj.title.trim() || null : null,
      authors: Array.isArray(obj.authors)
        ? obj.authors.filter((a: unknown) => typeof a === 'string' && a.trim().length > 0).map((a: string) => a.trim())
        : [],
      year: typeof obj.year === 'number' && obj.year >= 1900 && obj.year <= 2100 ? obj.year : null,
      abstract: typeof obj.abstract === 'string' ? obj.abstract.trim() || null : null,
      keywords: Array.isArray(obj.keywords)
        ? obj.keywords.filter((k: unknown) => typeof k === 'string' && k.trim().length > 0).map((k: string) => k.trim())
        : [],
      doi: typeof obj.doi === 'string' ? normalizeDoi(obj.doi) : null,
      paperType: typeof obj.paperType === 'string' ? obj.paperType : null,
      journal: typeof obj.journal === 'string' ? obj.journal.trim() || null : null,
      volume: typeof obj.volume === 'string' ? obj.volume.trim() || null : null,
      issue: typeof obj.issue === 'string' ? obj.issue.trim() || null : null,
      pages: typeof obj.pages === 'string' ? obj.pages.trim() || null : null,
    };
  } catch {
    return emptyResult();
  }
}

function normalizeDoi(raw: string): string | null {
  // Extract DOI from various formats
  const m = raw.match(/(10\.\d{4,9}\/\S+)/);
  if (!m) return null;
  // Clean trailing punctuation
  return m[1]!.replace(/[.,;:)\]}>]+$/, '');
}

function emptyResult(): LlmExtractedMetadata {
  return {
    title: null, authors: [], year: null, abstract: null, keywords: [],
    doi: null, paperType: null, journal: null, volume: null, issue: null, pages: null,
  };
}
