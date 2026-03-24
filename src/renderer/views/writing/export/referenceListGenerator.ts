/**
 * referenceListGenerator — Scans all sections for citations, generates
 * an ordered reference list.
 *
 * Algorithm:
 * 1. Extract all [@paper_id] markers from the combined markdown
 * 2. Deduplicate while maintaining first-occurrence order
 * 3. For numbered styles (IEEE, GB/T 7714): assign sequential numbers
 * 4. Format each reference using formatFullReference
 * 5. Return the complete reference list as a formatted string
 */

import type { CitationStyle } from '../../../../shared-types/enums';
import { formatFullReference } from './citationFormatter';
import type { PaperInfo } from './citationFormatter';
import { CITATION_REGEX } from '../shared/citationPattern';

/**
 * Extract unique paper IDs from markdown in order of first appearance.
 */
export function extractCitationIds(allMarkdown: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  let match: RegExpExecArray | null;
  // Reset lastIndex before iterating
  CITATION_REGEX.lastIndex = 0;

  while ((match = CITATION_REGEX.exec(allMarkdown)) !== null) {
    const paperId = match[1];
    if (paperId !== undefined && !seen.has(paperId)) {
      seen.add(paperId);
      ordered.push(paperId);
    }
  }

  return ordered;
}

/**
 * Generate a complete, formatted reference list string from the combined
 * markdown of all article sections.
 *
 * @param allMarkdown - Concatenated markdown from all sections
 * @param papers      - Map of paper ID to paper metadata
 * @param style       - Citation style to use for formatting
 *
 * @returns Formatted reference list ready for export
 */
export function generateReferenceList(
  allMarkdown: string,
  papers: Map<string, PaperInfo>,
  style: CitationStyle,
): string {
  const citedIds = extractCitationIds(allMarkdown);

  if (citedIds.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (let i = 0; i < citedIds.length; i++) {
    const paperId = citedIds[i]!;
    const paper = papers.get(paperId);

    if (!paper) {
      // Paper not found in the provided map; emit a placeholder
      const index = i + 1;
      lines.push(formatMissingReference(paperId, style, index));
      continue;
    }

    const index = i + 1; // 1-based numbering
    lines.push(formatFullReference(paper, style, index));
  }

  // Add a header based on citation style convention
  const header = getReferenceHeader(style);
  return `${header}\n\n${lines.join('\n')}`;
}

/**
 * Replace inline citation markers with formatted citation text.
 *
 * For numbered styles (IEEE, GB/T 7714), replaces [@id] with [N].
 * For author-year styles (APA, Chicago), replaces with formatted text.
 */
export function replaceCitationMarkers(
  markdown: string,
  papers: Map<string, PaperInfo>,
  style: CitationStyle,
): string {
  // Build an ordered id list to determine numbering
  const orderedIds = extractCitationIds(markdown);
  const indexMap = new Map<string, number>();
  for (let i = 0; i < orderedIds.length; i++) {
    indexMap.set(orderedIds[i]!, i + 1);
  }

  return markdown.replace(CITATION_REGEX, (_fullMatch: string, paperId: string): string => {
    const paper = papers.get(paperId);
    const index = indexMap.get(paperId) ?? 0;

    if (!paper) {
      // Unknown paper — keep the marker as-is or use placeholder
      return style === 'IEEE' || style === 'GB/T 7714'
        ? `[?]`
        : `(${paperId}, n.d.)`;
    }

    // Format inline citation based on style
    switch (style) {
      case 'APA': {
        const first = paper.authors[0];
        if (!first) return `(${paper.year})`;
        const surname = extractSurname(first.name);
        return paper.authors.length > 2
          ? `(${surname} et al., ${paper.year})`
          : paper.authors.length === 2
            ? `(${surname} & ${extractSurname(paper.authors[1]!.name)}, ${paper.year})`
            : `(${surname}, ${paper.year})`;
      }
      case 'IEEE':
        return `[${index}]`;
      case 'GB/T 7714':
        return `[${index}]`;
      case 'Chicago': {
        const first = paper.authors[0];
        if (!first) return `(${paper.year})`;
        const surname = extractSurname(first.name);
        return paper.authors.length > 3
          ? `(${surname} et al. ${paper.year})`
          : `(${surname} ${paper.year})`;
      }
    }

    // Exhaustive fallback — unreachable when CitationStyle is fully resolved
    return _fullMatch;
  });
}

// ── Internal helpers ──

function formatMissingReference(
  paperId: string,
  style: CitationStyle,
  index: number,
): string {
  switch (style) {
    case 'APA':
      return `${paperId}. (n.d.). [Reference not found].`;
    case 'IEEE':
      return `[${index}] ${paperId}, "[Reference not found]."`;
    case 'GB/T 7714':
      return `[${index}] ${paperId}. [Reference not found][J].`;
    case 'Chicago':
      return `${paperId}. "[Reference not found]."`;
    default: {
      const _exhaustive1: never = style;
      return _exhaustive1;
    }
  }
}

function getReferenceHeader(style: CitationStyle): string {
  switch (style) {
    case 'APA':
      return 'References';
    case 'IEEE':
      return 'References';
    case 'GB/T 7714':
      return '参考文献';
    case 'Chicago':
      return 'Bibliography';
    default: {
      const _exhaustive2: never = style;
      return _exhaustive2;
    }
  }
}

function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}
