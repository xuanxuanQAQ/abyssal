/**
 * Deterministic Section Summary — generates preceding section summaries
 * without LLM calls.
 *
 * Strategy:
 * - Short sections (≤500 words): full first paragraph
 * - Long sections: first paragraph + last paragraph's first sentence
 * - Truncated to ~500 tokens max
 *
 * This is used for "Article Structure Context" in the article prompt,
 * giving the LLM awareness of what came before the current section.
 *
 * See spec: §3.6
 */

import { countTokens } from '../../../llm-client/token-counter';

// ─── Types ───

export interface SectionSummaryInput {
  title: string;
  seq: number;
  content: string;
}

export interface SectionSummaryOutput {
  title: string;
  seq: number;
  summary: string;
}

// ─── Generate summary (§3.6) ───

/**
 * Generate a deterministic summary of a section's content.
 *
 * Cost: zero. Latency: <1ms. Idempotent: yes.
 */
export function generateSectionSummary(content: string): string {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return '';

  const wordCount = content.split(/\s+/).length;

  if (wordCount <= 500) {
    // Short section — first paragraph is enough
    return paragraphs[0]!.trim();
  }

  // Long section — first paragraph + last paragraph's first sentence
  const firstParagraph = paragraphs[0]!.trim();
  const lastParagraph = paragraphs[paragraphs.length - 1]!.trim();
  const lastFirstSentence = extractFirstSentence(lastParagraph);

  let summary = firstParagraph + '\n\n' + lastFirstSentence;

  // Truncate to ~500 tokens
  if (countTokens(summary) > 500) {
    summary = truncateToTokenLimit(summary, 500);
  }

  return summary;
}

/**
 * Format preceding sections as context block for article prompt.
 */
export function formatPrecedingContext(
  sections: SectionSummaryInput[],
  followingTitles: Array<{ title: string; seq: number }>,
): string {
  const lines: string[] = [];

  if (sections.length > 0) {
    lines.push('### Preceding Sections:');
    for (const s of sections) {
      const summary = s.content ? generateSectionSummary(s.content) : '(no content yet)';
      const preview = summary.length > 200 ? summary.slice(0, 197) + '...' : summary;
      lines.push(`- Section ${s.seq}: ${s.title} — ${preview}`);
    }
  }

  if (followingTitles.length > 0) {
    lines.push('');
    lines.push('### Following Sections:');
    for (const s of followingTitles) {
      lines.push(`- Section ${s.seq}: ${s.title}`);
    }
  }

  return lines.join('\n');
}

// ─── Helpers ───

function extractFirstSentence(paragraph: string): string {
  // Match sentence ending with period, question mark, or exclamation
  const match = paragraph.match(/^(.*?[.!?])\s/s);
  return match ? match[1]! : paragraph.slice(0, 150);
}

function truncateToTokenLimit(text: string, maxTokens: number): string {
  const current = countTokens(text);
  if (current <= maxTokens) return text;

  const ratio = maxTokens / current;
  const charEstimate = Math.floor(text.length * ratio * 0.9);
  return text.slice(0, charEstimate) + '...';
}
