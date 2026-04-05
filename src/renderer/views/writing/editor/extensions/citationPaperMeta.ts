import type { Author, Paper } from '../../../../../shared-types/models';

function isAuthor(value: unknown): value is Author {
  return typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';
}

export function getFirstAuthorName(authors: Paper['authors'] | null | undefined): string {
  if (!Array.isArray(authors)) return '';

  const firstAuthor = authors.find(isAuthor);
  return firstAuthor?.name.trim() ?? '';
}

export function buildCitationDisplayText(
  paper: Pick<Paper, 'authors' | 'year'> | null | undefined,
  paperId: string,
): string {
  if (!paper) return `@${paperId}`;

  const firstAuthor = getFirstAuthorName(paper.authors);
  const surname = firstAuthor.split(/\s+/).pop() ?? firstAuthor;

  if (surname && paper.year) return `${surname}, ${paper.year}`;
  if (surname) return surname;
  return `@${paperId}`;
}