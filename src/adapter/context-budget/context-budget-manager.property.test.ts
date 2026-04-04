import { fc, it as fcIt } from '@fast-check/vitest';
import { ContextBudgetManager } from './context-budget-manager';
import type { SourceEstimate } from './source-priority';

const logger = { warn: vi.fn() };

function makeManager() {
  return new ContextBudgetManager(logger as any);
}

describe('ContextBudgetManager properties', () => {
  const sourceArb = fc.record({
    sourceType: fc.constantFrom<SourceEstimate['sourceType']>(
      'paper_fulltext',
      'rag_passages',
      'concept_framework',
      'researcher_memos',
      'researcher_annotations',
      'preceding_context',
      'synthesis_fragments',
      'writing_instruction',
    ),
    estimatedTokens: fc.integer({ min: 1, max: 5000 }),
    priority: fc.constantFrom<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH', 'MEDIUM', 'LOW'),
    content: fc.constant(null),
  });

  fcIt.prop([
    fc.array(sourceArb, { minLength: 1, maxLength: 12 }),
    fc.integer({ min: 4000, max: 200000 }),
  ])('does not allocate more non-ABSOLUTE budget than distributable budget', (sources, modelContextWindow) => {
    const manager = makeManager();
    const result = manager.allocate({
      taskType: 'analyze',
      model: 'claude-opus-4',
      modelContextWindow,
      costPreference: 'balanced',
      sources,
      conceptMaturities: ['working'],
    });

    const allocated = Array.from(result.sourceAllocations.values())
      .filter((entry) => entry.included)
      .reduce((sum, entry) => sum + entry.budgetTokens, 0);

    expect(allocated).toBeLessThanOrEqual(result.totalBudget);
  });
});