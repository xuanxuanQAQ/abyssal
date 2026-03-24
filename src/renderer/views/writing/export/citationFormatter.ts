/**
 * citationFormatter — Citation display text formatting by style (S4.3)
 *
 * Supports four citation styles:
 * - APA:       (Author, Year)
 * - IEEE:      [N]
 * - GB/T 7714: [N] with author-year full reference
 * - Chicago:   (Author Year)
 *
 * Provides both inline citation text and full reference list entry formatting.
 */

import type { CitationStyle } from '../../../../shared-types/enums';

export interface PaperInfo {
  id: string;
  title: string;
  authors: Array<{ name: string }>;
  year: number;
}

// ── Inline citation formatters ──

/**
 * Format a short inline citation string for a paper.
 *
 * @param paper - Paper metadata
 * @param style - Citation style
 * @param index - 1-based citation index (required for IEEE and GB/T 7714)
 */
export function formatCitation(
  paper: PaperInfo,
  style: CitationStyle,
  index?: number,
): string {
  switch (style) {
    case 'APA':
      return formatAPACitation(paper);
    case 'IEEE':
      return formatIEEECitation(index ?? 0);
    case 'GB/T 7714':
      return formatGBTCitation(paper, index ?? 0);
    case 'Chicago':
      return formatChicagoCitation(paper);
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

function formatAPACitation(paper: PaperInfo): string {
  const firstAuthor = paper.authors[0];
  if (!firstAuthor) return `(${paper.year})`;

  const surname = extractSurname(firstAuthor.name);
  if (paper.authors.length === 1) {
    return `(${surname}, ${paper.year})`;
  }
  if (paper.authors.length === 2) {
    const second = extractSurname(paper.authors[1]!.name);
    return `(${surname} & ${second}, ${paper.year})`;
  }
  return `(${surname} et al., ${paper.year})`;
}

function formatIEEECitation(index: number): string {
  return `[${index}]`;
}

function formatGBTCitation(paper: PaperInfo, index: number): string {
  // GB/T 7714 uses numbered citations like IEEE but shows author in some contexts
  if (index > 0) return `[${index}]`;

  const firstAuthor = paper.authors[0];
  if (!firstAuthor) return `[${paper.year}]`;

  const surname = extractSurname(firstAuthor.name);
  const etAl = paper.authors.length > 1 ? '等' : '';
  return `[${surname}${etAl}, ${paper.year}]`;
}

function formatChicagoCitation(paper: PaperInfo): string {
  const firstAuthor = paper.authors[0];
  if (!firstAuthor) return `(${paper.year})`;

  const surname = extractSurname(firstAuthor.name);
  if (paper.authors.length === 1) {
    return `(${surname} ${paper.year})`;
  }
  if (paper.authors.length <= 3) {
    const names = paper.authors.map((a) => extractSurname(a.name));
    const last = names.pop()!;
    return `(${names.join(', ')} and ${last} ${paper.year})`;
  }
  return `(${surname} et al. ${paper.year})`;
}

// ── Full reference formatters ──

/**
 * Format a full reference list entry for a paper.
 *
 * @param paper - Paper metadata
 * @param style - Citation style
 * @param index - 1-based reference number
 */
export function formatFullReference(
  paper: PaperInfo,
  style: CitationStyle,
  index: number,
): string {
  switch (style) {
    case 'APA':
      return formatAPAReference(paper);
    case 'IEEE':
      return formatIEEEReference(paper, index);
    case 'GB/T 7714':
      return formatGBTReference(paper, index);
    case 'Chicago':
      return formatChicagoReference(paper);
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

function formatAPAReference(paper: PaperInfo): string {
  const authorStr = formatAuthorListAPA(paper.authors);
  return `${authorStr} (${paper.year}). ${paper.title}.`;
}

function formatIEEEReference(paper: PaperInfo, index: number): string {
  const authorStr = formatAuthorListIEEE(paper.authors);
  return `[${index}] ${authorStr}, "${paper.title}," ${paper.year}.`;
}

function formatGBTReference(paper: PaperInfo, index: number): string {
  const authorStr = formatAuthorListGBT(paper.authors);
  return `[${index}] ${authorStr}. ${paper.title}[J]. ${paper.year}.`;
}

function formatChicagoReference(paper: PaperInfo): string {
  const authorStr = formatAuthorListChicago(paper.authors);
  return `${authorStr}. "${paper.title}." ${paper.year}.`;
}

// ── Author list formatting helpers ──

function formatAuthorListAPA(
  authors: Array<{ name: string }>,
): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) {
    return formatAuthorAPA(authors[0]!.name);
  }
  if (authors.length === 2) {
    return `${formatAuthorAPA(authors[0]!.name)}, & ${formatAuthorAPA(authors[1]!.name)}`;
  }
  // 3+ authors: first 19, then "... LastAuthor" (simplified to first + et al.)
  const formatted = authors
    .slice(0, 19)
    .map((a) => formatAuthorAPA(a.name));
  if (authors.length > 19) {
    const last = formatted.pop()!;
    return `${formatted.join(', ')}, ... ${last}`;
  }
  const last = formatted.pop()!;
  return `${formatted.join(', ')}, & ${last}`;
}

function formatAuthorAPA(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  const surname = parts[parts.length - 1]!;
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
  return `${surname}, ${initials}`;
}

function formatAuthorListIEEE(
  authors: Array<{ name: string }>,
): string {
  if (authors.length === 0) return '';
  if (authors.length <= 6) {
    return authors
      .map((a) => formatAuthorIEEE(a.name))
      .join(', ');
  }
  const first = authors.slice(0, 3).map((a) => formatAuthorIEEE(a.name));
  return `${first.join(', ')}, et al.`;
}

function formatAuthorIEEE(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  const surname = parts[parts.length - 1]!;
  const initials = parts
    .slice(0, -1)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
  return `${initials} ${surname}`;
}

function formatAuthorListGBT(
  authors: Array<{ name: string }>,
): string {
  if (authors.length === 0) return '';
  if (authors.length <= 3) {
    return authors.map((a) => a.name).join(', ');
  }
  const first3 = authors.slice(0, 3).map((a) => a.name);
  return `${first3.join(', ')}, 等`;
}

function formatAuthorListChicago(
  authors: Array<{ name: string }>,
): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) return authors[0]!.name;
  if (authors.length <= 3) {
    const names = [...authors.map((a) => a.name)];
    const last = names.pop()!;
    return `${names.join(', ')}, and ${last}`;
  }
  return `${authors[0]!.name} et al.`;
}

// ── Utilities ──

function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}
