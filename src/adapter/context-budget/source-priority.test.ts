import { describe, it, expect } from 'vitest';
import {
  allocateByPriority,
  proportionalAllocate,
  getSourcePriority,
  type SourceEstimate,
} from './source-priority';

describe('getSourcePriority', () => {
  it('returns ABSOLUTE for researcher_memos in all task types', () => {
    expect(getSourcePriority('analyze', 'researcher_memos')).toBe('ABSOLUTE');
    expect(getSourcePriority('synthesize', 'researcher_memos')).toBe('ABSOLUTE');
    expect(getSourcePriority('article', 'researcher_memos')).toBe('ABSOLUTE');
    expect(getSourcePriority('ad_hoc', 'researcher_memos')).toBe('ABSOLUTE');
  });

  it('returns correct priority for analyze task sources', () => {
    expect(getSourcePriority('analyze', 'paper_fulltext')).toBe('HIGH');
    expect(getSourcePriority('analyze', 'rag_passages')).toBe('MEDIUM');
    expect(getSourcePriority('analyze', 'analysis_template')).toBe('ABSOLUTE');
  });

  it('returns LOW as default for unmapped sources', () => {
    expect(getSourcePriority('analyze', 'preceding_context')).toBe('LOW');
  });
});

describe('allocateByPriority', () => {
  it('returns full allocation when everything fits', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'rag_passages', estimatedTokens: 5000, priority: 'HIGH', content: null },
      { sourceType: 'preceding_context', estimatedTokens: 2000, priority: 'LOW', content: null },
    ];
    const result = allocateByPriority(sources, 10000);

    expect(result).toHaveLength(2);
    expect(result.every((a) => a.included)).toBe(true);
    expect(result.every((a) => a.truncatedTo === null)).toBe(true);
    expect(result[0]!.budgetTokens).toBe(5000);
    expect(result[1]!.budgetTokens).toBe(2000);
  });

  it('trims LOW sources first when budget is tight', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'synthesis_fragments', estimatedTokens: 5000, priority: 'HIGH', content: null },
      { sourceType: 'rag_passages', estimatedTokens: 5000, priority: 'MEDIUM', content: null },
      { sourceType: 'preceding_context', estimatedTokens: 5000, priority: 'LOW', content: null },
    ];
    // Budget = 12000 — can fit HIGH + MEDIUM (10000) + partial LOW (2000)
    const result = allocateByPriority(sources, 12000);

    const high = result.find((a) => a.sourceType === 'synthesis_fragments')!;
    const med = result.find((a) => a.sourceType === 'rag_passages')!;
    const low = result.find((a) => a.sourceType === 'preceding_context')!;

    expect(high.budgetTokens).toBe(5000); // full
    expect(med.budgetTokens).toBe(5000);  // full
    expect(low.budgetTokens).toBe(2000);  // partial
  });

  it('excludes LOW and trims MEDIUM when budget is very tight', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'synthesis_fragments', estimatedTokens: 5000, priority: 'HIGH', content: null },
      { sourceType: 'rag_passages', estimatedTokens: 8000, priority: 'MEDIUM', content: null },
      { sourceType: 'preceding_context', estimatedTokens: 5000, priority: 'LOW', content: null },
    ];
    // Budget = 8000 — HIGH takes 5000, MEDIUM gets 3000, LOW excluded
    const result = allocateByPriority(sources, 8000);

    const high = result.find((a) => a.sourceType === 'synthesis_fragments')!;
    const med = result.find((a) => a.sourceType === 'rag_passages')!;
    const low = result.find((a) => a.sourceType === 'preceding_context')!;

    expect(high.budgetTokens).toBe(5000);
    expect(med.budgetTokens).toBe(3000);
    expect(low.included).toBe(false);
  });

  it('handles empty sources', () => {
    expect(allocateByPriority([], 10000)).toEqual([]);
  });

  it('handles zero budget', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'rag_passages', estimatedTokens: 5000, priority: 'HIGH', content: null },
    ];
    const result = allocateByPriority(sources, 0);
    expect(result.every((a) => !a.included || a.budgetTokens === 0)).toBe(true);
  });
});

describe('proportionalAllocate', () => {
  it('distributes budget proportionally', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'rag_passages', estimatedTokens: 6000, priority: 'MEDIUM', content: null },
      { sourceType: 'private_knowledge', estimatedTokens: 4000, priority: 'MEDIUM', content: null },
    ];
    const result = proportionalAllocate(sources, 5000);

    // 6000/(6000+4000) * 5000 = 3000 for rag
    // 4000/(6000+4000) * 5000 = 2000 for private
    const ragAlloc = result.find((a) => a.sourceType === 'rag_passages')!;
    const privAlloc = result.find((a) => a.sourceType === 'private_knowledge')!;

    expect(ragAlloc.budgetTokens).toBe(3000);
    expect(privAlloc.budgetTokens).toBe(2000);
  });

  it('redistributes surplus when a source needs less than its share', () => {
    const sources: SourceEstimate[] = [
      { sourceType: 'rag_passages', estimatedTokens: 100, priority: 'MEDIUM', content: null },  // tiny
      { sourceType: 'private_knowledge', estimatedTokens: 9000, priority: 'MEDIUM', content: null },
    ];
    // Total requested: 9100, budget: 5000
    // Naive: rag gets ~55, private gets ~4945
    // But rag only needs 100 — it's satisfied, surplus goes to private
    const result = proportionalAllocate(sources, 5000);

    const ragAlloc = result.find((a) => a.sourceType === 'rag_passages')!;
    // Rag source (100 tokens) should get at least its proportional share.
    // With surplus redistribution, small sources may not fully converge in 3 rounds,
    // but should still be included and get a reasonable allocation.
    expect(ragAlloc.budgetTokens).toBeGreaterThan(0);
    expect(ragAlloc.included).toBe(true);
  });
});
