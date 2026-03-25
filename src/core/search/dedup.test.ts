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
    const a = makePaper({ title: 'Deep Learning for NLP', year: 2023 });
    const b = makePaper({ title: 'Deep Learning for NLP', year: 2024 });
    const result = deduplicatePapers([a, b]);
    expect(result).toHaveLength(1);
  });

  it('does NOT merge papers with same title but year difference > 1', () => {
    const a = makePaper({ title: 'Deep Learning for NLP', year: 2020 });
    const b = makePaper({ title: 'Deep Learning for NLP', year: 2023 });
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
    const b = makePaper({ doi: null, arxivId: '2301.99999', title: 'Completely Different Paper' });
    const c = makePaper({ doi: '10.1234/shared', arxivId: null });
    const result = deduplicatePapers([a, b, c]);
    expect(result).toHaveLength(2);
  });
});
