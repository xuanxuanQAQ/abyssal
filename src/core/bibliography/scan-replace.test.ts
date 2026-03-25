import { scanAndReplace, exportForLatex, exportForPandoc } from './scan-replace';
import { asPaperId, type PaperId } from '@core/types/common';
import type { PaperMetadata } from '@core/types/paper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock CslEngine satisfying the interface used by scanAndReplace. */
const mockEngine = {
  formatCitation: (papers: Array<{ paperId: PaperId; metadata: PaperMetadata }>) =>
    papers.map((p) => ({
      paperId: p.paperId,
      inlineCitation: `(${p.metadata.authors[0]?.split(',')[0] ?? 'Author'}, ${p.metadata.year})`,
      fullEntry: '',
      cslStyleId: '',
      missingFieldWarnings: [],
    })),
  formatBibliography: () => 'Bibliography here',
};

function paper(id: string, overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    id: asPaperId(id),
    title: 'Test Paper',
    authors: ['Smith, John'],
    year: 2024,
    doi: null,
    arxivId: null,
    venue: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: null,
    abstract: null,
    citationCount: null,
    paperType: 'journal',
    source: 'manual',
    bibtexKey: null,
    biblioComplete: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// scanAndReplace
// ---------------------------------------------------------------------------

describe('scanAndReplace', () => {
  it('returns original text unchanged when there are no citations', () => {
    const md = 'This is plain text with no citations.';
    const map = new Map<PaperId, PaperMetadata>();

    const result = scanAndReplace(md, map, mockEngine as any);

    expect(result.text).toBe(md);
    expect(result.bibliography).toBe('');
    expect(result.citedPaperIds).toEqual([]);
  });

  it('replaces a single citation with the formatted inline citation', () => {
    const id = asPaperId('abcdef012345');
    const map = new Map<PaperId, PaperMetadata>([[id, paper('abcdef012345')]]);
    const md = 'See [@abcdef012345] for details.';

    const result = scanAndReplace(md, map, mockEngine as any);

    expect(result.text).toBe('See (Smith, 2024) for details.');
    expect(result.citedPaperIds).toEqual([id]);
    expect(result.bibliography).toBe('Bibliography here');
  });

  it('merges multiple citations in one bracket with semicolons', () => {
    const id1 = asPaperId('aaaaaaaaaaaa');
    const id2 = asPaperId('bbbbbbbbbbbb');
    const map = new Map<PaperId, PaperMetadata>([
      [id1, paper('aaaaaaaaaaaa', { authors: ['Alice, A.'] })],
      [id2, paper('bbbbbbbbbbbb', { authors: ['Bob, B.'], year: 2023 })],
    ]);
    const md = 'Evidence [@aaaaaaaaaaaa; @bbbbbbbbbbbb] shows this.';

    const result = scanAndReplace(md, map, mockEngine as any);

    expect(result.text).toBe('Evidence (Alice, 2024); (Bob, 2023) shows this.');
    expect(result.citedPaperIds).toHaveLength(2);
    expect(result.citedPaperIds).toContain(id1);
    expect(result.citedPaperIds).toContain(id2);
  });

  it('appends a locator when present', () => {
    const id = asPaperId('cccccccccccc');
    const map = new Map<PaperId, PaperMetadata>([[id, paper('cccccccccccc')]]);
    const md = 'See [@cccccccccccc, p.23] for details.';

    const result = scanAndReplace(md, map, mockEngine as any);

    // The locator is appended inside the closing paren: (Smith, 2024) → (Smith, 2024, p.23)
    // The implementation replaces trailing ')' with ', <locator>)'
    expect(result.text).toContain('p.23');
    expect(result.text).toContain('Smith');
  });

  it('preserves unknown IDs as [@id] when not found in paperMap', () => {
    const knownId = asPaperId('aaaaaaaaaaaa');
    const unknownHex = 'ffffffffffff';
    const map = new Map<PaperId, PaperMetadata>([
      [knownId, paper('aaaaaaaaaaaa')],
    ]);
    const md = `Known [@aaaaaaaaaaaa] and unknown [@${unknownHex}].`;

    const result = scanAndReplace(md, map, mockEngine as any);

    // The known citation is formatted; the unknown one is kept as-is
    expect(result.text).toContain('(Smith, 2024)');
    expect(result.text).toContain(`[@${unknownHex}]`);
  });
});

// ---------------------------------------------------------------------------
// exportForLatex
// ---------------------------------------------------------------------------

describe('exportForLatex', () => {
  it('replaces @id with \\cite{bibtexKey}', () => {
    const id = asPaperId('abcdef012345');
    const map = new Map<PaperId, PaperMetadata>([
      [id, paper('abcdef012345', { bibtexKey: 'smith2024test' })],
    ]);
    const md = 'As shown in [@abcdef012345], the result holds.';

    const { tex, bib } = exportForLatex(md, map);

    expect(tex).toContain('\\cite{smith2024test}');
    expect(tex).not.toContain('abcdef012345');
    expect(typeof bib).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// exportForPandoc
// ---------------------------------------------------------------------------

describe('exportForPandoc', () => {
  it('replaces @id with [@bibtexKey]', () => {
    const id = asPaperId('abcdef012345');
    const map = new Map<PaperId, PaperMetadata>([
      [id, paper('abcdef012345', { bibtexKey: 'smith2024test' })],
    ]);
    const md = 'As shown in [@abcdef012345], the result holds.';

    const { md: outMd, bib } = exportForPandoc(md, map);

    expect(outMd).toContain('[@smith2024test]');
    expect(outMd).not.toContain('abcdef012345');
    expect(typeof bib).toBe('string');
  });
});
