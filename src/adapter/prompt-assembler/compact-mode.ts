/**
 * Compact Mode — extreme truncation for small context windows (< 3000 available tokens).
 *
 * §8: Triggered when T_available < 3000 (local 7B/13B models with 4K-8K windows).
 *
 * Truncation rules:
 * - Concept framework: name_en + definition only (no keywords/maturity/parent)
 * - Memos: max 3, each truncated to 50 chars
 * - Annotations: max 3
 * - Paper fulltext: abstract + each section's first paragraph (~2000 tokens)
 * - RAG: top-1 only
 * - Output format: simplified schema (no example)
 */

import type { ConceptForSubset } from './concept-subset-selector';
import type { MemoForInjection } from './memo-injector';
import type { AnnotationForInjection } from './annotation-injector';
import type { RagPassage } from './retrieval-formatter';
import type { SectionMapEntry } from './fulltext-compressor';

// ─── Threshold ───

export const COMPACT_MODE_THRESHOLD = 2000;

/**
 * Check whether compact mode should be activated.
 * Lowered from 3000 to 2000 — only trigger for truly tiny context windows
 * (e.g. local 7B models with 4K windows). At 2000-3000 tokens, normal
 * truncation already handles budget adequately.
 */
export function shouldUseCompactMode(availableBudget: number): boolean {
  return availableBudget < COMPACT_MODE_THRESHOLD;
}

// ─── Concept framework compaction ───

/**
 * §8.2: Compact concept format — only name + definition.
 */
export function compactConceptFormat(concepts: ConceptForSubset[]): string {
  const lines = concepts.map(
    (c) => `- **${c.nameEn}**: ${c.definition.slice(0, 200)}`,
  );
  return '# Concepts (compact)\n\n' + lines.join('\n');
}

// ─── Memo compaction ───

const MAX_COMPACT_MEMOS = 3;
const MAX_COMPACT_MEMO_CHARS = 120;

/**
 * §8.2: Truncate memos to max 3, each to 120 chars.
 * Raised from 50 to preserve one-sentence semantic content.
 */
export function compactMemos(memos: MemoForInjection[]): MemoForInjection[] {
  return memos.slice(0, MAX_COMPACT_MEMOS).map((m) => ({
    ...m,
    text: m.text.length > MAX_COMPACT_MEMO_CHARS
      ? m.text.slice(0, MAX_COMPACT_MEMO_CHARS) + '...'
      : m.text,
  }));
}

// ─── Annotation compaction ───

const MAX_COMPACT_ANNOTATIONS = 3;

/**
 * §8.2: Limit annotations to max 3.
 */
export function compactAnnotations(
  annotations: AnnotationForInjection[],
): AnnotationForInjection[] {
  return annotations.slice(0, MAX_COMPACT_ANNOTATIONS);
}

// ─── Fulltext ultra-compression ───

/**
 * §8.2: Ultra-compress fulltext — abstract + each section's first paragraph.
 * Target: ~2000 tokens total.
 */
export function ultraCompressFulltext(
  text: string,
  sectionMap: SectionMapEntry[] | null,
): string {
  if (!sectionMap || sectionMap.length === 0) {
    // No section map: take first ~3000 chars
    return text.slice(0, 3000) + '\n\n[... truncated for compact mode ...]';
  }

  const parts: string[] = [];

  // Abstract (full)
  const abstractSection = sectionMap.find((s) => s.sectionType === 'abstract');
  if (abstractSection) {
    parts.push(text.slice(abstractSection.startOffset, abstractSection.endOffset));
  }

  // Each body section: first paragraph only
  const excludedTypes = new Set(['references', 'acknowledgments', 'appendix', 'abstract']);
  for (const section of sectionMap) {
    if (excludedTypes.has(section.sectionType)) continue;
    const sectionText = text.slice(section.startOffset, section.endOffset);
    const firstParagraph = sectionText.split(/\n\s*\n/)[0] ?? '';
    if (firstParagraph.trim()) {
      parts.push(`**${section.title}**\n${firstParagraph.trim()}`);
    }
  }

  return parts.join('\n\n');
}

// ─── RAG compaction ───

/**
 * §8.2: Limit RAG passages to top-1.
 */
export function compactRagPassages(passages: RagPassage[]): RagPassage[] {
  if (passages.length === 0) return [];
  // Sort by score, take top-1
  const sorted = [...passages].sort((a, b) => b.score - a.score);
  return [sorted[0]!];
}
