import { makePaper, resetFixtureSeq } from '@test-utils/fixtures';
import { deduplicatePapers } from './dedup';

beforeEach(() => {
  resetFixtureSeq();
});

describe('deduplicatePapers', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicatePapers([])).toEqual([]);
  });

  it('merges two papers that share the same DOI', () => {
    const a = makePaper({ doi: '10.1234/abc', arxivId: null });
    const b = makePaper({ doi: '10.1234/abc', arxivId: null });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
  });

  it('merges two papers that share the same arXiv ID', () => {
    const a = makePaper({ arxivId: '2301.12345' });
    const b = makePaper({ arxivId: '2301.12345' });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
  });

  it('merges two papers with the same normalised title and year within ±1', () => {
    const a = makePaper({ title: 'Deep Learning for Natural Language Processing', year: 2023 });
    const b = makePaper({ title: 'Deep Learning for Natural Language Processing', year: 2024 });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
  });

  it('does NOT merge papers with same title but year difference > 1', () => {
    const a = makePaper({ title: 'Deep Learning for Natural Language Processing', year: 2020 });
    const b = makePaper({ title: 'Deep Learning for Natural Language Processing', year: 2023 });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(2);
  });

  it('preserves the longer title after merge', () => {
    const a = makePaper({
      doi: '10.1234/abc',
      title: 'Short',
    });
    const b = makePaper({
      doi: '10.1234/abc',
      title: 'A Much Longer Title That Should Be Preserved',
    });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('A Much Longer Title That Should Be Preserved');
  });

  it('takes non-null fields from both sources during merge', () => {
    const a = makePaper({
      doi: '10.1234/abc',
      arxivId: null,
      abstract: 'An abstract from source A',
      pmid: null,
    });
    const b = makePaper({
      doi: '10.1234/abc',
      arxivId: '2301.99999',
      abstract: null,
      pmid: 'PM12345',
    });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.arxivId).toBe('2301.99999');
    expect(result[0]!.abstract).toBe('An abstract from source A');
    expect(result[0]!.pmid).toBe('PM12345');
  });

  it('deduplicates three papers: A and C share DOI, B is distinct → result length is 2', () => {
    const a = makePaper({ doi: '10.1234/shared', arxivId: null });
    const b = makePaper({ doi: null, arxivId: '2301.99999', title: 'Completely Different Paper Title Here' });
    const c = makePaper({ doi: '10.1234/shared', arxivId: null });
    const result = deduplicatePapers([a, b, c]);
    expect(result).toHaveLength(2);
  });

  // ─── Fix #9: PaperId 稳定性 ───

  it('preserves the first paper ID after merge (no PaperId regeneration)', () => {
    const a = makePaper({ doi: '10.1234/abc', arxivId: null });
    const originalId = a.id;
    const b = makePaper({ doi: '10.1234/abc', arxivId: '2301.99999' });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
    // Merged paper should retain the FIRST paper's ID
    expect(result[0]!.id).toBe(originalId);
  });

  // ─── Fix #5: year 取 min ───

  it('takes minimum year after merge (preprint year)', () => {
    const a = makePaper({ doi: '10.1234/abc', year: 2024 }); // journal year
    const b = makePaper({ doi: '10.1234/abc', year: 2023 }); // preprint year
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.year).toBe(2023);
  });

  // ─── Fix #6: source 遵循 biblioPreferred 逻辑 ───

  it('uses crossref/openalex source when available (biblioPreferred)', () => {
    const a = makePaper({ doi: '10.1234/abc', source: 'semantic_scholar' });
    const b = makePaper({ doi: '10.1234/abc', source: 'crossref' });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('crossref');
  });

  // ─── Fix #4: 短标题不触发 Level 3 匹配 ───

  it('does NOT merge papers with very short titles even if normalized match', () => {
    // "NLP" → after stop word removal only 1 content word → below MIN_TITLE_TOKENS_FOR_DEDUP
    const a = makePaper({ title: 'NLP', year: 2023 });
    const b = makePaper({ title: 'NLP', year: 2023 });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(2);
  });

  it('merges papers with sufficiently long matching titles', () => {
    const a = makePaper({ title: 'Attention Mechanism Based Neural Network Architecture', year: 2023 });
    const b = makePaper({ title: 'Attention Mechanism Based Neural Network Architecture', year: 2024 });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
  });

  // ─── Fix #1: titleYearMap 合并后更新 ───

  it('updates titleYearMap after merge so third paper can match', () => {
    // Paper A: no DOI, matched by title
    const a = makePaper({ title: 'Novel Approach Deep Learning Computer Vision', year: 2023 });
    // Paper B: matches A by title+year via Level 3
    const b = makePaper({ title: 'Novel Approach Deep Learning Computer Vision', year: 2023 });
    // Paper C: same title, year 2024 (within ±1 of merged year)
    const c = makePaper({ title: 'Novel Approach Deep Learning Computer Vision', year: 2024 });
    const result = deduplicatePapers([a, b, c]);
    expect(result).toHaveLength(1);
  });

  // ─── 跨级别合并 ───

  it('merges across levels: arXiv match fills DOI, subsequent DOI match finds it', () => {
    const a = makePaper({ doi: null, arxivId: '2301.11111' });
    const b = makePaper({ doi: '10.1234/xyz', arxivId: '2301.11111' }); // matches A via arXiv, fills DOI
    const c = makePaper({ doi: '10.1234/xyz', arxivId: null }); // should match via DOI now
    const result = deduplicatePapers([a, b, c]);
    expect(result).toHaveLength(1);
  });
});
