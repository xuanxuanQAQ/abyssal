import { describe, it, expect, vi } from 'vitest';
import { ContextBudgetManager } from './context-budget-manager';
import type { SourceEstimate } from './source-priority';

const logger = { warn: vi.fn() };

function makeCBM() {
  return new ContextBudgetManager(logger);
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    taskType: 'analyze' as const,
    model: 'claude-opus-4',
    modelContextWindow: 200_000,
    costPreference: 'balanced' as const,
    sources: [] as SourceEstimate[],
    conceptMaturities: ['working'],
    ...overrides,
  };
}

describe('ContextBudgetManager', () => {
  // ─── Strategy selection ───

  it('selects full when totalEstimated < 50% of window', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      sources: [
        { sourceType: 'paper_fulltext', estimatedTokens: 5000, priority: 'HIGH', content: null },
      ],
      modelContextWindow: 200_000,
    }));
    expect(result.strategy).toBe('full');
  });

  it('selects focused for ad_hoc tasks', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      taskType: 'ad_hoc',
      sources: [
        { sourceType: 'rag_passages', estimatedTokens: 120_000, priority: 'MEDIUM', content: null },
      ],
    }));
    expect(result.strategy).toBe('focused');
  });

  it('selects broad for synthesize when window >= 128K', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      taskType: 'synthesize',
      modelContextWindow: 200_000,
      sources: [
        { sourceType: 'rag_passages', estimatedTokens: 120_000, priority: 'HIGH', content: null },
      ],
    }));
    expect(result.strategy).toBe('broad');
  });

  // ─── ABSOLUTE source handling ───

  it('preserves ABSOLUTE sources when they fit within budget', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      sources: [
        { sourceType: 'researcher_memos', estimatedTokens: 500, priority: 'ABSOLUTE', content: null },
        { sourceType: 'concept_framework', estimatedTokens: 1000, priority: 'ABSOLUTE', content: null },
        { sourceType: 'rag_passages', estimatedTokens: 120_000, priority: 'MEDIUM', content: null },
      ],
    }));

    const memosAlloc = result.sourceAllocations.get('researcher_memos');
    expect(memosAlloc?.included).toBe(true);
    expect(memosAlloc?.truncatedTo).toBeNull();
    expect(memosAlloc?.budgetTokens).toBe(500);
  });

  it('preserves ABSOLUTE sources and logs overflow when they exceed budget', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      modelContextWindow: 2000, // very small
      sources: [
        { sourceType: 'researcher_memos', estimatedTokens: 5000, priority: 'ABSOLUTE', content: null },
        { sourceType: 'concept_framework', estimatedTokens: 5000, priority: 'ABSOLUTE', content: null },
      ],
    }));

    const memosAlloc = result.sourceAllocations.get('researcher_memos');
    const fwAlloc = result.sourceAllocations.get('concept_framework');
    expect(memosAlloc?.included).toBe(true);
    expect(fwAlloc?.included).toBe(true);
    expect(memosAlloc!.budgetTokens).toBe(5000);
    expect(fwAlloc!.budgetTokens).toBe(5000);
    expect(memosAlloc!.truncatedTo).toBeNull();
    expect(fwAlloc!.truncatedTo).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  // ─── Priority-based trimming ───

  it('trims LOW before MEDIUM before HIGH', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      modelContextWindow: 50_000,
      taskType: 'article',
      sources: [
        { sourceType: 'writing_instruction', estimatedTokens: 500, priority: 'ABSOLUTE', content: null },
        { sourceType: 'synthesis_fragments', estimatedTokens: 10_000, priority: 'HIGH', content: null },
        { sourceType: 'rag_passages', estimatedTokens: 30_000, priority: 'MEDIUM', content: null },
        { sourceType: 'preceding_context', estimatedTokens: 20_000, priority: 'LOW', content: null },
      ],
    }));

    // HIGH should be fully allocated
    const highAlloc = result.sourceAllocations.get('synthesis_fragments');
    expect(highAlloc?.included).toBe(true);

    // LOW should be trimmed first
    const lowAlloc = result.sourceAllocations.get('preceding_context');
    if (result.truncated) {
      // If trimming happened, LOW should be most affected
      expect(lowAlloc!.budgetTokens).toBeLessThanOrEqual(highAlloc!.budgetTokens);
    }
  });

  it('drops LOW sources before trimming HIGH sources under severe pressure', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      modelContextWindow: 20_000,
      taskType: 'article',
      sources: [
        { sourceType: 'writing_instruction', estimatedTokens: 500, priority: 'ABSOLUTE', content: null },
        { sourceType: 'synthesis_fragments', estimatedTokens: 7_000, priority: 'HIGH', content: null },
        { sourceType: 'rag_passages', estimatedTokens: 5_000, priority: 'MEDIUM', content: null },
        { sourceType: 'preceding_context', estimatedTokens: 6_000, priority: 'LOW', content: null },
      ],
    }));

    const highAlloc = result.sourceAllocations.get('synthesis_fragments');
    const lowAlloc = result.sourceAllocations.get('preceding_context');

    expect(highAlloc?.included).toBe(true);
    expect(lowAlloc?.included).toBe(false);
    expect(lowAlloc?.budgetTokens).toBe(0);
    expect(highAlloc?.budgetTokens).toBeGreaterThan(0);
  });

  // ─── Maturity-aware adjustment ───

  it('increases ragTopK by 1.5x for tentative concepts', () => {
    const cbm = makeCBM();
    const baseResult = cbm.allocate(makeRequest({
      conceptMaturities: ['established'],
      sources: [
        { sourceType: 'rag_passages', estimatedTokens: 120_000, priority: 'MEDIUM', content: null },
      ],
    }));

    const tentativeResult = cbm.allocate(makeRequest({
      conceptMaturities: ['tentative'],
      sources: [
        { sourceType: 'rag_passages', estimatedTokens: 120_000, priority: 'MEDIUM', content: null },
      ],
    }));

    expect(tentativeResult.ragTopK).toBeGreaterThanOrEqual(Math.ceil(baseResult.ragTopK * 1.4));
  });

  // ─── Smart degradation ───

  it('skips reranker when totalEstimated < 30% of window', () => {
    const cbm = makeCBM();
    const result = cbm.allocate(makeRequest({
      modelContextWindow: 200_000,
      sources: [
        { sourceType: 'paper_fulltext', estimatedTokens: 10_000, priority: 'HIGH', content: null },
      ],
    }));
    expect(result.skipReranker).toBe(true);
  });
});
