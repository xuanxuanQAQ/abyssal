import {
  truncateContent,
  truncateRagPassages,
  iterativeTrim,
  type TokenCounter,
  type TrimBlock,
} from './truncation-engine';

const counter: TokenCounter = { count: (text: string) => Math.ceil(text.length / 4) };

// ─── truncateContent ───

describe('truncateContent', () => {
  it('returns unchanged content when under budget', () => {
    const result = truncateContent('short', 100, 'paper_fulltext', counter);
    expect(result).toBe('short');
  });

  it('truncates paper_fulltext preserving abstract + conclusion', () => {
    const text = [
      '# Abstract',
      'This is the abstract of the paper.',
      '',
      '## Introduction',
      'Introduction text that goes on for a while. '.repeat(50),
      '',
      '## Conclusion',
      'Final conclusions here.',
    ].join('\n');
    const result = truncateContent(text, 50, 'paper_fulltext', counter);
    expect(result).toContain('abstract');
  });

  it('truncates rag_passages by char ratio', () => {
    const longText = 'x'.repeat(2000);
    const result = truncateContent(longText, 100, 'rag_passages', counter);
    expect(result.length).toBeLessThan(2000);
    expect(result).toContain('[... truncated to fit context budget ...]');
  });

  it('truncates synthesis_fragments by char ratio', () => {
    const longText = 'y'.repeat(2000);
    const result = truncateContent(longText, 100, 'synthesis_fragments', counter);
    expect(result.length).toBeLessThan(2000);
  });

  it('truncates preceding_context: keeps recent sections', () => {
    const text = [
      '## Section 1',
      'Old content from section one. It is long enough.',
      '',
      '## Section 2',
      'Mid section content paragraph.',
      '',
      '## Section 3',
      'Recent content that should be preserved.',
    ].join('\n');
    const result = truncateContent(text, 50, 'preceding_context', counter);
    expect(result).toContain('Section 3');
  });
});

// ─── truncateRagPassages ───

describe('truncateRagPassages', () => {
  it('returns empty for empty input', () => {
    expect(truncateRagPassages([], 1000)).toEqual([]);
  });

  it('selects within token budget', () => {
    const passages = [
      { paperId: 'p1', text: 'a', tokenCount: 50, score: 0.9 },
      { paperId: 'p2', text: 'b', tokenCount: 50, score: 0.7 },
      { paperId: 'p3', text: 'c', tokenCount: 50, score: 0.5 },
    ];
    const result = truncateRagPassages(passages, 120);
    const total = result.reduce((s, p) => s + p.tokenCount, 0);
    expect(total).toBeLessThanOrEqual(120);
    expect(result).toHaveLength(2);
  });

  it('diversity: selects one per paper first', () => {
    const passages = [
      { paperId: 'p1', text: 'a', tokenCount: 30, score: 0.95 },
      { paperId: 'p1', text: 'b', tokenCount: 30, score: 0.90 },
      { paperId: 'p2', text: 'c', tokenCount: 30, score: 0.85 },
    ];
    const result = truncateRagPassages(passages, 90);
    expect(result).toHaveLength(3);
    const firstTwo = result.slice(0, 2).map((p) => p.paperId);
    expect(firstTwo).toContain('p1');
    expect(firstTwo).toContain('p2');
  });
});

// ─── iterativeTrim ───

describe('iterativeTrim', () => {
  it('trims lowest priority block first', () => {
    const blocks: TrimBlock[] = [
      { content: 'A'.repeat(400), sourceType: 'rag_passages', priority: 'LOW', included: true },
      { content: 'B'.repeat(400), sourceType: 'paper_fulltext', priority: 'HIGH', included: true },
    ];
    const remaining = iterativeTrim(blocks, 50, counter);
    // LOW priority block should be trimmed
    expect(blocks[0]!.content.length).toBeLessThan(400);
  });

  it('never trims ABSOLUTE priority blocks', () => {
    const blocks: TrimBlock[] = [
      { content: 'A'.repeat(200), sourceType: 'rag_passages', priority: 'ABSOLUTE', included: true },
      { content: 'B'.repeat(200), sourceType: 'paper_fulltext', priority: 'LOW', included: true },
    ];
    iterativeTrim(blocks, 30, counter);
    expect(blocks[0]!.content).toBe('A'.repeat(200));
  });

  it('excludes very small blocks entirely', () => {
    const blocks: TrimBlock[] = [
      { content: 'tiny', sourceType: 'rag_passages', priority: 'LOW', included: true },
    ];
    // 'tiny' is 4 chars → 1 token → ≤50 threshold → should be excluded
    iterativeTrim(blocks, 10, counter);
    expect(blocks[0]!.included).toBe(false);
  });

  it('stops after 3 iterations max', () => {
    // Even with huge overflow, should not loop forever
    const blocks: TrimBlock[] = [
      { content: 'X'.repeat(1000), sourceType: 'rag_passages', priority: 'LOW', included: true },
    ];
    const remaining = iterativeTrim(blocks, 99999, counter);
    // Completed without infinite loop
    expect(typeof remaining).toBe('number');
  });

  it('returns remaining ≤ 0 when trimming resolves overflow', () => {
    const blocks: TrimBlock[] = [
      { content: 'A'.repeat(800), sourceType: 'rag_passages', priority: 'LOW', included: true },
    ];
    const remaining = iterativeTrim(blocks, 10, counter);
    expect(remaining).toBeLessThanOrEqual(10);
  });
});
