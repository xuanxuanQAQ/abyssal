/**
 * Truncation Engine — content-aware truncation strategies and iterative trimming.
 *
 * Different source types use different truncation strategies:
 * - paper_fulltext: compress mode — keep abstract + section skeletons + conclusion
 * - rag_passages: score-based with diversity (different papers first)
 * - synthesis_fragments: concept-relevance based
 * - preceding_context: keep most recent 2 sections + older section summaries
 * - private_knowledge / generic: score-based truncation
 *
 * See spec: §5.2 (truncateContent strategies), §5.3 (iterative trimming)
 */

import type { SourceType, SourcePriority } from '../context-budget/source-priority';
import {
  compressFulltext as compressFulltextStructured,
  type SectionMapEntry,
} from './fulltext-compressor';
import {
  truncateRagPassages as truncateRagDiversity,
  type RagPassage as RagPassageExtended,
} from './retrieval-formatter';

// ─── Token counter interface ───

export interface TokenCounter {
  count: (text: string) => number;
}

// ─── Main truncation dispatch (§5.2) ───

/**
 * Truncate content to fit within targetTokens, using strategy appropriate
 * to the source type.
 */
export function truncateContent(
  content: string,
  targetTokens: number,
  sourceType: SourceType,
  tokenCounter: TokenCounter,
): string {
  const currentTokens = tokenCounter.count(content);
  if (currentTokens <= targetTokens) return content;

  switch (sourceType) {
    case 'paper_fulltext':
      return compressFulltext(content, targetTokens, tokenCounter);
    case 'rag_passages':
      return truncateByCharRatio(content, targetTokens, currentTokens);
    case 'synthesis_fragments':
      return truncateByCharRatio(content, targetTokens, currentTokens);
    case 'preceding_context':
      return compressPrecedingContext(content, targetTokens, tokenCounter);
    default:
      return truncateByCharRatio(content, targetTokens, currentTokens);
  }
}

// ─── paper_fulltext compression (§5.2) ───

/**
 * Compress fulltext while preserving document skeleton.
 *
 * Strategy:
 * 1. Always preserve abstract and conclusion
 * 2. Distribute remaining budget across body sections
 * 3. For sections that exceed their share: keep first paragraph + last sentence
 *
 * TODO: Accept sectionMap from src/core/process/extract-sections.ts for
 *       precise section boundary detection. Currently uses heuristic splitting.
 */
function compressFulltext(
  text: string,
  targetTokens: number,
  tokenCounter: TokenCounter,
): string {
  // Heuristic section extraction
  const { abstract, conclusion, bodySections } = extractDocumentParts(text);

  const abstractTokens = tokenCounter.count(abstract);
  const conclusionTokens = tokenCounter.count(conclusion);
  const fixedTokens = abstractTokens + conclusionTokens;

  const remainingBudget = targetTokens - fixedTokens;

  if (remainingBudget <= 0) {
    return abstract + '\n\n[...body omitted...]\n\n' + conclusion;
  }

  if (bodySections.length === 0) {
    // No clear sections — just char-ratio truncate the body
    const bodyOnly = text.replace(abstract, '').replace(conclusion, '').trim();
    const truncated = truncateByCharRatio(bodyOnly, remainingBudget, tokenCounter.count(bodyOnly));
    return abstract + '\n\n' + truncated + '\n\n' + conclusion;
  }

  // Distribute remaining budget across body sections
  const perSection = Math.floor(remainingBudget / bodySections.length);
  const compressedParts: string[] = [abstract, ''];

  for (const section of bodySections) {
    const sectionTokens = tokenCounter.count(section);
    if (sectionTokens <= perSection) {
      compressedParts.push(section);
    } else {
      // Keep first paragraph + last paragraph's first sentence
      const firstParagraph = extractFirstParagraph(section);
      const lastFirstSentence = extractLastParagraphFirstSentence(section);
      compressedParts.push(firstParagraph + '\n[...]\n' + lastFirstSentence);
    }
  }

  compressedParts.push('', conclusion);
  return compressedParts.join('\n\n');
}

// ─── preceding_context compression ───

/**
 * Compress preceding context: keep 2 most recent sections fully,
 * summarize older sections to one sentence each.
 */
function compressPrecedingContext(
  content: string,
  targetTokens: number,
  tokenCounter: TokenCounter,
): string {
  const sections = content.split(/\n## /);
  if (sections.length <= 2) {
    return truncateByCharRatio(content, targetTokens, tokenCounter.count(content));
  }

  // Keep last 2 sections fully
  const recent = sections.slice(-2).map((s, i) => (i === 0 ? s : '## ' + s));
  const older = sections.slice(0, -2);

  // Summarize older sections to first sentence
  const olderSummaries = older.map((s) => {
    const header = s.match(/^(.*?)$/m)?.[0] ?? '';
    const firstSentence = extractFirstSentence(s.replace(header, '').trim());
    return (header ? '## ' + header + '\n' : '') + firstSentence + ' [...]';
  });

  const result = [...olderSummaries, ...recent].join('\n\n');
  const resultTokens = tokenCounter.count(result);

  if (resultTokens <= targetTokens) return result;

  // Still too long — truncate by ratio
  return truncateByCharRatio(result, targetTokens, resultTokens);
}

// ─── RAG passage truncation with diversity (§5.2) ───

export interface RagPassage {
  paperId: string;
  text: string;
  tokenCount: number;
  score: number;
}

/**
 * Truncate RAG passages with paper diversity: pick one top-scoring chunk
 * per paper first, then fill with remaining by score (§5.2).
 */
export function truncateRagPassages(
  passages: RagPassage[],
  targetTokens: number,
): RagPassage[] {
  const sorted = [...passages].sort((a, b) => b.score - a.score);

  const result: RagPassage[] = [];
  const selectedPaperIds = new Set<string>();
  let totalTokens = 0;

  // Pass 1: one chunk per paper (diversity)
  for (const passage of sorted) {
    if (selectedPaperIds.has(passage.paperId)) continue;
    if (totalTokens + passage.tokenCount > targetTokens) break;
    result.push(passage);
    selectedPaperIds.add(passage.paperId);
    totalTokens += passage.tokenCount;
  }

  // Pass 2: fill remaining budget (allow duplicates from same paper)
  for (const passage of sorted) {
    if (result.includes(passage)) continue;
    if (totalTokens + passage.tokenCount > targetTokens) break;
    result.push(passage);
    totalTokens += passage.tokenCount;
  }

  return result;
}

// ─── Iterative trimming engine (§5.3) ───

export interface TrimBlock {
  content: string;
  sourceType: SourceType;
  priority: SourcePriority;
  included: boolean;
}

/**
 * Iteratively trim blocks by 20% starting from lowest priority,
 * until overflow is resolved (max 3 iterations).
 */
export function iterativeTrim(
  blocks: TrimBlock[],
  overflowTokens: number,
  tokenCounter: TokenCounter,
): number {
  const MAX_ITERATIONS = 3;
  let remaining = overflowTokens;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (remaining <= 0) break;

    // Find lowest-priority trimmable block
    const candidates = blocks.filter(
      (b) => b.priority !== 'ABSOLUTE' && b.included && b.content.length > 0,
    );
    if (candidates.length === 0) break;

    // Priority ordering: LOW < MEDIUM < HIGH
    const priorityOrder: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, ABSOLUTE: 3 };
    candidates.sort(
      (a, b) => (priorityOrder[a.priority] ?? 0) - (priorityOrder[b.priority] ?? 0),
    );

    const target = candidates[0]!;
    const currentTokens = tokenCounter.count(target.content);

    // Fix #5: Trim proportional to overflow, not fixed 20%.
    // Only cut what's needed (+ 100 token safety buffer), capped at 20% max.
    const precisionCut = remaining + 100;
    const maxCut = Math.floor(currentTokens * 0.2);
    const actualCut = Math.min(precisionCut, maxCut);
    const newTarget = Math.max(0, currentTokens - actualCut);

    target.content = truncateContent(
      target.content,
      newTarget,
      target.sourceType,
      tokenCounter,
    );

    remaining -= actualCut;
  }

  return remaining;
}

// ─── Helpers ───

function truncateByCharRatio(text: string, targetTokens: number, currentTokens: number): string {
  if (currentTokens <= targetTokens) return text;
  const ratio = targetTokens / currentTokens;
  const charEstimate = Math.floor(text.length * ratio * 0.9); // 10% safety margin
  return text.slice(0, charEstimate) + '\n\n[... truncated to fit context budget ...]';
}

interface DocumentParts {
  abstract: string;
  conclusion: string;
  bodySections: string[];
}

function extractDocumentParts(text: string): DocumentParts {
  const lines = text.split('\n');
  let abstract = '';
  let conclusion = '';
  const bodySections: string[] = [];
  let currentSection = '';
  let inAbstract = false;
  let inConclusion = false;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    if (lower.startsWith('abstract') || lower.match(/^#+\s*abstract/i)) {
      inAbstract = true;
      inConclusion = false;
      if (currentSection.trim()) bodySections.push(currentSection.trim());
      currentSection = '';
      abstract += line + '\n';
      continue;
    }

    if (lower.match(/^#+?\s*(conclusion|conclusions|summary and conclusions)/i)) {
      inConclusion = true;
      inAbstract = false;
      if (currentSection.trim()) bodySections.push(currentSection.trim());
      currentSection = '';
      conclusion += line + '\n';
      continue;
    }

    if (line.match(/^#+\s/) && !inAbstract && !inConclusion) {
      inAbstract = false;
      if (currentSection.trim()) bodySections.push(currentSection.trim());
      currentSection = line + '\n';
      continue;
    }

    if (inAbstract) {
      if (line.match(/^#+\s/)) {
        inAbstract = false;
        if (currentSection.trim()) bodySections.push(currentSection.trim());
        currentSection = line + '\n';
      } else {
        abstract += line + '\n';
      }
    } else if (inConclusion) {
      conclusion += line + '\n';
    } else {
      currentSection += line + '\n';
    }
  }

  if (currentSection.trim()) bodySections.push(currentSection.trim());

  // Fallbacks if we didn't find explicit sections
  if (!abstract && text.length > 500) {
    abstract = text.slice(0, 500);
  }
  if (!conclusion && text.length > 500) {
    conclusion = text.slice(-300);
  }

  return {
    abstract: abstract.trim(),
    conclusion: conclusion.trim(),
    bodySections,
  };
}

function extractFirstParagraph(text: string): string {
  const paragraphs = text.split(/\n\n+/);
  return paragraphs[0]?.trim() ?? '';
}

function extractLastParagraphFirstSentence(text: string): string {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return '';
  const lastParagraph = paragraphs[paragraphs.length - 1]!;
  return extractFirstSentence(lastParagraph);
}

function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : text.slice(0, 200).trim();
}

// ─── Structured compression delegation (§6.1) ───

/**
 * Compress fulltext using precise sectionMap boundaries when available.
 * Falls back to heuristic extraction when sectionMap is null.
 *
 * Re-exports the structured compressor from fulltext-compressor.ts.
 */
export function compressFulltextWithSectionMap(
  text: string,
  sectionMap: SectionMapEntry[] | null,
  targetTokens: number,
  tokenCounter: TokenCounter,
): string {
  return compressFulltextStructured(text, sectionMap, targetTokens, tokenCounter);
}

/**
 * Truncate RAG passages with paper diversity using the enhanced formatter.
 * Re-exports from retrieval-formatter.ts.
 */
export function truncateRagPassagesWithDiversity(
  passages: RagPassageExtended[],
  targetTokens: number,
): RagPassageExtended[] {
  return truncateRagDiversity(passages, targetTokens);
}

// Re-export types for consumers
export type { SectionMapEntry } from './fulltext-compressor';
export type { RagPassage as RagPassageExtended } from './retrieval-formatter';
