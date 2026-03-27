/**
 * Section Formatter — per-region formatting with metadata headers.
 *
 * Each region uses a Markdown H2 header + HTML comment with token/priority
 * metadata for debugging transparency (§6.4). The HTML comment does not
 * consume LLM attention but aids prompt debugging.
 *
 * See spec: §6 (region definitions), §3.4 (annotation formatting)
 */

import type { SourceType, SourcePriority } from '../context-budget/source-priority';

// ─── Types ───

export interface FormattedSection {
  content: string;
  sourceType: SourceType;
  priority: SourcePriority;
  tokenCount: number;
  placement: 'system' | 'user';
}

// ─── Section header formatting (§6.4) ───

/**
 * Wrap content with a region header containing metadata comment.
 *
 * Output format:
 *   ## {title}
 *   <!-- source: {sourceType}, tokens: {tokenCount}, priority: {priority} -->
 *
 *   {content}
 */
export function formatSectionBlock(
  title: string,
  content: string,
  sourceType: SourceType,
  priority: SourcePriority,
  tokenCount: number,
): string {
  if (!content || content.trim().length === 0) return '';

  return [
    `## ${title}`,
    `<!-- source: ${sourceType}, tokens: ${tokenCount}, priority: ${priority} -->`,
    '',
    content,
  ].join('\n');
}

// ─── Annotation formatting (§3.4) ───

export interface AnnotationForFormat {
  page?: number;
  annotationType?: string;
  selectedText?: string;
  comment?: string;
  conceptId?: string;
  conceptName?: string;
}

/**
 * Format researcher annotations for prompt injection.
 *
 * Per-annotation format (§3.4):
 *   ⭐ [Page {page}] {annotation_type}
 *   Text: "{selected_text}"
 *   Note: "{comment}"          (if present)
 *   Concept: {concept_name}    (if present)
 */
export function formatAnnotations(annotations: AnnotationForFormat[]): string {
  if (annotations.length === 0) return '';

  const lines: string[] = [];
  for (const a of annotations) {
    const pageStr = a.page != null ? `Page ${a.page}` : 'Page ?';
    const typeStr = a.annotationType ?? 'highlight';
    lines.push(`⭐ [${pageStr}] ${typeStr}`);

    if (a.selectedText) {
      lines.push(`Text: "${a.selectedText}"`);
    }
    if (a.comment) {
      lines.push(`Note: "${a.comment}"`);
    }
    if (a.conceptId && a.conceptName) {
      lines.push(`Concept: ${a.conceptName}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Memo formatting ───

export interface MemoForFormat {
  text: string;
  createdAt: string;
  conceptIds: string[];
  paperIds: string[];
}

/**
 * Format research memos for "Researcher's Intuitions & Notes" section.
 */
export function formatMemos(memos: MemoForFormat[], currentPaperId?: string): string {
  if (memos.length === 0) return '';

  const lines: string[] = [];
  for (const m of memos) {
    const date = formatDate(m.createdAt);
    let line = `- [${date}] ${m.text}`;
    if (m.conceptIds.length > 0) {
      line += `\n  (Related concepts: ${m.conceptIds.join(', ')})`;
    }
    const otherPapers = currentPaperId
      ? m.paperIds.filter((id) => id !== currentPaperId)
      : m.paperIds;
    if (otherPapers.length > 0) {
      line += `\n  (Also relates to papers: ${otherPapers.join(', ')})`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

// ─── Concept framework formatting ───

export interface ConceptForFormat {
  id: string;
  nameEn: string;
  nameZh: string;
  definition: string;
  searchKeywords: string[];
  maturity: 'tentative' | 'working' | 'established';
}

/**
 * Format concept framework for system prompt injection.
 * Includes maturity-specific special instructions for tentative concepts.
 */
export function formatConceptFramework(concepts: ConceptForFormat[]): string {
  if (concepts.length === 0) return '';

  const lines: string[] = [];
  lines.push('The researcher has defined the following concepts. For each concept,');
  lines.push('assess how the paper relates to it.\n');

  for (const c of concepts) {
    lines.push(`### ${c.nameEn} (${c.nameZh})`);
    lines.push(`- **ID**: ${c.id}`);
    lines.push(`- **Definition**: ${c.definition}`);
    lines.push(`- **Keywords**: ${c.searchKeywords.join(', ')}`);
    lines.push(`- **Maturity**: ${c.maturity}`);

    if (c.maturity === 'tentative') {
      lines.push(`- **⚠️ Special Instruction**: This concept is tentative — the researcher`);
      lines.push(`  is still exploring whether this conceptualization is appropriate.`);
      lines.push(`  Please critically evaluate whether the paper's evidence supports this`);
      lines.push(`  way of framing the concept. If you believe a better conceptualization`);
      lines.push(`  exists, describe it in your analysis and suggest it as a`);
      lines.push(`  \`suggested_new_concept\`.`);
      lines.push(`  A low confidence score (< 0.5) is expected and acceptable.`);
    }

    if (c.maturity === 'established') {
      lines.push(`- **Note**: This concept's definition is stable and well-supported by`);
      lines.push(`  existing literature. Focus your assessment on the quality and`);
      lines.push(`  specificity of the evidence this paper provides, rather than`);
      lines.push(`  questioning the concept itself.`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── RAG passages formatting ───

export interface RagPassageForFormat {
  paperId: string;
  paperTitle?: string;
  chunkId: string;
  text: string;
  score: number;
}

/**
 * Format RAG passages grouped by paper for cross-paper context.
 */
export function formatRagPassages(passages: RagPassageForFormat[]): string {
  if (passages.length === 0) return '';

  // Group by paper
  const byPaper = new Map<string, RagPassageForFormat[]>();
  for (const p of passages) {
    const existing = byPaper.get(p.paperId) ?? [];
    existing.push(p);
    byPaper.set(p.paperId, existing);
  }

  const lines: string[] = [];
  for (const [paperId, chunks] of byPaper) {
    const title = chunks[0]?.paperTitle ?? paperId;
    lines.push(`### From: ${title} (${paperId})`);
    for (const chunk of chunks) {
      lines.push(`> ${chunk.text}`);
      lines.push(`> _(score: ${chunk.score.toFixed(3)}, chunk: ${chunk.chunkId})_`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Adjudication history formatting ───

export interface AdjudicationForFormat {
  paperId: string;
  paperTitle: string;
  paperYear: number;
  relation: string;
  confidence: number;
  decision: 'accepted' | 'revised' | 'rejected';
  decisionNote: string | null;
  revisedRelation?: string | undefined;
  revisedConfidence?: number | undefined;
}

/**
 * Format adjudication history for synthesize/article prompts.
 */
export function formatAdjudicationHistory(
  conceptName: string,
  entries: AdjudicationForFormat[],
): string {
  if (entries.length === 0) return '';

  const accepted = entries.filter((e) => e.decision === 'accepted');
  const revised = entries.filter((e) => e.decision === 'revised');
  const rejected = entries.filter((e) => e.decision === 'rejected');
  const total = entries.length;

  const lines: string[] = [];

  if (accepted.length > 0) {
    lines.push('Accepted mappings (use as reliable evidence):');
    for (const e of accepted) {
      lines.push(`- Paper ${e.paperId} (${e.paperTitle}, ${e.paperYear}): ${e.relation} with confidence ${e.confidence}`);
      if (e.decisionNote) lines.push(`  Researcher note: "${e.decisionNote}"`);
    }
    lines.push('');
  }

  if (revised.length > 0) {
    lines.push("Revised mappings (use the researcher's corrected version):");
    for (const e of revised) {
      lines.push(`- Paper ${e.paperId}: AI said "${e.relation}" → Researcher revised to "${e.revisedRelation}" (conf: ${e.confidence}→${e.revisedConfidence})`);
      if (e.decisionNote) lines.push(`  Reason: "${e.decisionNote}"`);
    }
    lines.push('');
  }

  if (rejected.length > 0) {
    lines.push('Rejected mappings (DO NOT use as evidence):');
    for (const e of rejected) {
      lines.push(`- Paper ${e.paperId}: AI said "${e.relation}" (conf: ${e.confidence})`);
      if (e.decisionNote) lines.push(`  Rejection reason: "${e.decisionNote}"`);
    }
    lines.push('');
  }

  lines.push(`Total: ${accepted.length} accepted, ${revised.length} revised, ${rejected.length} rejected out of ${total} mappings reviewed.`);

  return lines.join('\n');
}

// ─── Evidence gaps formatting ───

export function formatEvidenceGaps(conceptName: string, gaps: string[]): string {
  if (gaps.length === 0) return '';

  const lines: string[] = [];
  lines.push(`The retrieval system was unable to find sufficient evidence for the`);
  lines.push(`following aspects of concept "${conceptName}":`);
  for (const gap of gaps) {
    lines.push(`- ${gap}`);
  }
  lines.push('');
  lines.push('Please acknowledge these gaps honestly in your synthesis. Do not');
  lines.push('fabricate evidence. State clearly where the literature coverage');
  lines.push('is insufficient.');

  return lines.join('\n');
}

// ─── Protected paragraphs formatting ───

export function formatProtectedParagraphs(
  content: string,
  editedIndices: number[],
): string {
  if (editedIndices.length === 0) return '';

  const paragraphs = content.split(/\n\n+/);
  const lines: string[] = [];
  lines.push('The researcher has manually edited the following paragraphs in the');
  lines.push('previous version. You MUST preserve these paragraphs EXACTLY as-is');
  lines.push('in your output. Do not modify, rewrite, or rephrase them.\n');

  for (const idx of editedIndices) {
    if (idx >= 0 && idx < paragraphs.length) {
      lines.push(`Paragraph ${idx}:`);
      lines.push('"""');
      lines.push(paragraphs[idx]!);
      lines.push('"""');
      lines.push('');
    }
  }

  lines.push('You may adjust the surrounding text to maintain flow, but the protected');
  lines.push('paragraphs must appear verbatim in your output.');

  return lines.join('\n');
}

// ─── Helper ───

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
