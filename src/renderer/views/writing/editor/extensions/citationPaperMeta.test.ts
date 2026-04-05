import { describe, expect, it } from 'vitest';

import { buildCitationDisplayText, getFirstAuthorName } from './citationPaperMeta';

describe('citationPaperMeta', () => {
  it('extracts the first author name from structured author arrays', () => {
    expect(getFirstAuthorName([
      { name: 'Ada Lovelace' },
      { name: 'Grace Hopper' },
    ])).toBe('Ada Lovelace');
  });

  it('builds a surname-year citation label from structured paper metadata', () => {
    expect(buildCitationDisplayText({
      authors: [{ name: 'Ada Lovelace' }],
      year: 1843,
    }, 'paper-1')).toBe('Lovelace, 1843');
  });

  it('falls back to paper id when author metadata is unavailable', () => {
    expect(buildCitationDisplayText({
      authors: [],
      year: 0,
    }, 'paper-1')).toBe('@paper-1');
  });
});