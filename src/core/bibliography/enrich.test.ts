import { vi } from 'vitest';
import { enrichBibliography } from './enrich';
import { makePaper } from '@test-utils/fixtures';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHttp = {
  requestJson: vi.fn(),
};

const mockLimiter = {
  acquire: async () => {},
  freeze: () => {},
  tryAcquire: () => true,
};

/** Standard CrossRef-style response used across multiple tests. */
function crossRefResponse(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      'container-title': ['Nature'],
      'ISSN': ['0028-0836'],
      'volume': '123',
      'publisher': 'Springer',
      'abstract': '<jats:p>Some abstract</jats:p>',
      'author': [{ family: 'Smith', given: 'John' }],
      'type': 'journal-article',
      'published': { 'date-parts': [[2024]] },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// enrichBibliography
// ---------------------------------------------------------------------------

describe('enrichBibliography', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. No DOI → early return
  // -----------------------------------------------------------------------
  it('returns enriched: false immediately when paper has no DOI', async () => {
    const paper = makePaper({ doi: null });

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(false);
    expect(result.enrichedFields).toEqual([]);
    expect(mockHttp.requestJson).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. container-title as array → extracts first element
  // -----------------------------------------------------------------------
  it('extracts the first element when CrossRef container-title is an array', async () => {
    const paper = makePaper({ doi: '10.1234/test', journal: null });
    mockHttp.requestJson.mockResolvedValue(crossRefResponse({
      'container-title': ['Nature', 'Nature (London)'],
    }));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(true);
    expect(result.metadata.journal).toBe('Nature');
    expect(result.enrichedFields).toContain('journal');
  });

  // -----------------------------------------------------------------------
  // 3. ISSN as array → extracts first element
  // -----------------------------------------------------------------------
  it('extracts the first element when CrossRef ISSN is an array', async () => {
    const paper = makePaper({ doi: '10.1234/test', issn: null });
    mockHttp.requestJson.mockResolvedValue(crossRefResponse({
      'ISSN': ['0028-0836', '1476-4687'],
    }));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(true);
    expect(result.metadata.issn).toBe('0028-0836');
    expect(result.enrichedFields).toContain('issn');
  });

  // -----------------------------------------------------------------------
  // 4. Authors filled from CrossRef when empty
  // -----------------------------------------------------------------------
  it('fills empty authors from CrossRef response', async () => {
    const paper = makePaper({ doi: '10.1234/test', authors: [] });
    mockHttp.requestJson.mockResolvedValue(crossRefResponse({
      'author': [
        { family: 'Smith', given: 'John' },
        { family: 'Doe', given: 'Jane' },
      ],
    }));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(true);
    expect(result.metadata.authors).toEqual(['Smith, John', 'Doe, Jane']);
    expect(result.enrichedFields).toContain('authors');
  });

  // -----------------------------------------------------------------------
  // 5. JATS tags in abstract are cleaned
  // -----------------------------------------------------------------------
  it('cleans JATS XML tags from the abstract', async () => {
    const paper = makePaper({ doi: '10.1234/test', abstract: null });
    mockHttp.requestJson.mockResolvedValue(crossRefResponse({
      'abstract': '<jats:p>Some <jats:italic>important</jats:italic> abstract</jats:p>',
    }));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(true);
    expect(result.metadata.abstract).not.toContain('<jats:');
    expect(result.metadata.abstract).toContain('important');
    expect(result.metadata.abstract).toContain('abstract');
  });

  // -----------------------------------------------------------------------
  // 6. Existing fields are NOT overwritten
  // -----------------------------------------------------------------------
  it('does not overwrite existing fields — only fills empty ones', async () => {
    const paper = makePaper({
      doi: '10.1234/test',
      journal: 'Science',
      publisher: 'AAAS',
      abstract: 'Existing abstract',
      authors: ['Existing, Author'],
    });
    mockHttp.requestJson.mockResolvedValue(crossRefResponse({
      'container-title': ['Nature'],
      'publisher': 'Springer',
      'abstract': '<jats:p>New abstract</jats:p>',
      'author': [{ family: 'Smith', given: 'John' }],
    }));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    // Original values must be preserved
    expect(result.metadata.journal).toBe('Science');
    expect(result.metadata.publisher).toBe('AAAS');
    expect(result.metadata.abstract).toBe('Existing abstract');
    expect(result.metadata.authors).toEqual(['Existing, Author']);

    // These fields should not appear in enrichedFields
    expect(result.enrichedFields).not.toContain('journal');
    expect(result.enrichedFields).not.toContain('publisher');
    expect(result.enrichedFields).not.toContain('abstract');
    expect(result.enrichedFields).not.toContain('authors');
  });

  // -----------------------------------------------------------------------
  // 7. 404 response → enriched: false, no throw
  // -----------------------------------------------------------------------
  it('returns enriched: false on a 404 response instead of throwing', async () => {
    const paper = makePaper({ doi: '10.1234/nonexistent' });
    mockHttp.requestJson.mockRejectedValue(new Error('404 Not Found'));

    const result = await enrichBibliography(paper, mockHttp as any, mockLimiter as any);

    expect(result.enriched).toBe(false);
    expect(result.enrichedFields).toEqual([]);
    expect(result.metadata).toEqual(paper);
  });
});
