import {
  truncateRagPassages,
  formatRetrievalResult,
  type RagPassage,
} from './retrieval-formatter';

// ─── truncateRagPassages (MMR score-decay) ───

describe('truncateRagPassages', () => {
  const makePassage = (overrides: Partial<RagPassage> = {}): RagPassage => ({
    paperId: 'p1',
    paperTitle: 'Paper 1',
    text: 'Sample text',
    score: 0.8,
    tokenCount: 100,
    source: 'paper',
    ...overrides,
  });

  it('returns empty array for empty input', () => {
    expect(truncateRagPassages([], 1000)).toEqual([]);
  });

  it('selects all passages when within budget', () => {
    const passages = [makePassage({ tokenCount: 50 }), makePassage({ tokenCount: 50 })];
    const result = truncateRagPassages(passages, 1000);
    expect(result).toHaveLength(2);
  });

  it('respects token budget', () => {
    const passages = [
      makePassage({ tokenCount: 60, score: 0.9 }),
      makePassage({ tokenCount: 60, score: 0.7 }),
    ];
    const result = truncateRagPassages(passages, 80);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(0.9);
  });

  it('prefers diversity: score decay for same-paper passages', () => {
    const passages = [
      makePassage({ paperId: 'p1', score: 0.95, tokenCount: 50 }),
      makePassage({ paperId: 'p1', score: 0.90, tokenCount: 50 }),
      makePassage({ paperId: 'p2', score: 0.80, tokenCount: 50 }),
    ];
    const result = truncateRagPassages(passages, 150);
    expect(result).toHaveLength(3);
    // First should be the highest score
    expect(result[0]!.paperId).toBe('p1');
    // Second should be from p2 (diverse paper wins over same-paper with decay)
    const paperIds = result.map((r) => r.paperId);
    expect(paperIds).toContain('p2');
  });

  it('uses custom decay factor', () => {
    const passages = [
      makePassage({ paperId: 'p1', score: 0.9, tokenCount: 50 }),
      makePassage({ paperId: 'p1', score: 0.85, tokenCount: 50 }),
      makePassage({ paperId: 'p2', score: 0.5, tokenCount: 50 }),
    ];
    // With decay=1.0 → no diversity penalty (score * 1^n = score)
    const noDiversity = truncateRagPassages(passages, 150, 1.0);
    // Without diversity, p1's second passage (0.85) beats p2 (0.5)
    expect(noDiversity[1]!.paperId).toBe('p1');
  });

  it('skips passages that exceed remaining budget', () => {
    const passages = [
      makePassage({ score: 0.9, tokenCount: 50 }),
      makePassage({ score: 0.8, tokenCount: 200 }), // too big
      makePassage({ score: 0.7, tokenCount: 50 }),
    ];
    const result = truncateRagPassages(passages, 120);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.tokenCount === 200)).toBeUndefined();
  });
});

// ─── formatRetrievalResult ───

describe('formatRetrievalResult', () => {
  const makePassage = (overrides: Partial<RagPassage> = {}): RagPassage => ({
    paperId: 'p1',
    paperTitle: 'Paper 1',
    year: 2024,
    text: 'Content here',
    score: 0.8,
    tokenCount: 100,
    source: 'paper',
    ...overrides,
  });

  it('returns empty string for no passages', () => {
    expect(formatRetrievalResult([])).toBe('');
  });

  it('formats annotation-sourced chunks with ⭐ prefix', () => {
    const passage = makePassage({ source: 'annotation', page: 5 });
    const result = formatRetrievalResult([passage]);
    expect(result).toContain('⭐');
    expect(result).toContain('[Researcher Annotation]');
    expect(result).toContain('P5');
  });

  it('formats memo-sourced chunks with 📝 prefix', () => {
    const passage = makePassage({ source: 'memo', date: '2025-01-15' });
    const result = formatRetrievalResult([passage]);
    expect(result).toContain('📝');
    expect(result).toContain('[Researcher Memo]');
    expect(result).toContain('2025-01-15');
  });

  it('groups paper chunks by paper', () => {
    const passages = [
      makePassage({ paperId: 'p1', paperTitle: 'First', positionRatio: 0.1 }),
      makePassage({ paperId: 'p1', paperTitle: 'First', positionRatio: 0.5 }),
      makePassage({ paperId: 'p2', paperTitle: 'Second', positionRatio: 0.2 }),
    ];
    const result = formatRetrievalResult(passages);
    expect(result).toContain('[Paper] First');
    expect(result).toContain('[Paper] Second');
  });

  it('merges adjacent chunks from same section within 5% position gap', () => {
    const passages = [
      makePassage({ sectionTitle: 'Intro', positionRatio: 0.10, text: 'part 1' }),
      makePassage({ sectionTitle: 'Intro', positionRatio: 0.13, text: 'part 2' }),
    ];
    const result = formatRetrievalResult(passages);
    // Merged: both texts should appear together
    expect(result).toContain('part 1');
    expect(result).toContain('part 2');
  });

  it('shows annotation chunks before paper chunks', () => {
    const passages = [
      makePassage({ source: 'paper', text: 'paper text' }),
      makePassage({ source: 'annotation', text: 'ann text' }),
    ];
    const result = formatRetrievalResult(passages);
    const annPos = result.indexOf('⭐');
    const paperPos = result.indexOf('[Paper]');
    expect(annPos).toBeLessThan(paperPos);
  });
});
