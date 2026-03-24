/**
 * Shared citation pattern — single source of truth for [@paperId] matching.
 */

/** Matches a complete citation: [@paperId] */
export const CITATION_REGEX = /\[@([a-zA-Z0-9_-]+)\]/g;

/** Matches a partial citation at end of string (for autocomplete): [@ or [@partial */
export const CITATION_PARTIAL_REGEX = /\[@([a-zA-Z0-9_-]*)$/;

/** Extracts all paper IDs from text containing [@...] citations */
export function extractCitedPaperIds(text: string): string[] {
  const ids: string[] = [];
  const regex = new RegExp(CITATION_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}
