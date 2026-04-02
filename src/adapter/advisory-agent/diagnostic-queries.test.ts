import { describe, it, expect } from 'vitest';
import { evaluateRules, type DiagnosticData } from './diagnostic-queries';

function makeEmptyDiagnostics(): DiagnosticData {
  return {
    conceptCoverage: [],
    unreviewedMappings: [],
    lowQualityMappings: [],
    acquireFailures: [],
    analyzeFailures: [],
    synthesisMissing: [],
    writingDependencies: [],
    pendingSuggestions: [],
    unstableDefinitions: [],
    maturityUpgrades: [],
    unindexedMemoCount: 0,
    conceptConflicts: [],
  };
}

describe('evaluateRules', () => {
  it('returns empty array for healthy project', () => {
    const suggestions = evaluateRules(makeEmptyDiagnostics());
    expect(suggestions).toEqual([]);
  });

  it('flags concept with < 2 papers as high priority', () => {
    const data = makeEmptyDiagnostics();
    data.conceptCoverage = [
      { conceptId: 'affordance', nameEn: 'Affordance', maturity: 'working', mappedPapers: 1, reviewedPapers: 1 },
    ];
    const suggestions = evaluateRules(data);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.priority).toBe('high');
    expect(suggestions[0]!.type).toBe('concept_coverage_low');
  });

  it('flags concept with 2-4 papers as medium priority', () => {
    const data = makeEmptyDiagnostics();
    data.conceptCoverage = [
      { conceptId: 'tom', nameEn: 'Theory of Mind', maturity: 'working', mappedPapers: 3, reviewedPapers: 2 },
    ];
    const suggestions = evaluateRules(data);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.priority).toBe('medium');
  });

  it('does not flag concepts with >= 5 papers', () => {
    const data = makeEmptyDiagnostics();
    data.conceptCoverage = [
      { conceptId: 'x', nameEn: 'X', maturity: 'established', mappedPapers: 10, reviewedPapers: 8 },
    ];
    const suggestions = evaluateRules(data);
    expect(suggestions).toHaveLength(0);
  });

  it('handles unreviewed mappings with total > 0', () => {
    const data = makeEmptyDiagnostics();
    data.unreviewedMappings = [
      { conceptId: 'affordance', total: 10, unreviewed: 8 },
    ];
    const suggestions = evaluateRules(data);
    expect(suggestions.some((s) => s.type === 'mapping_unreviewed')).toBe(true);
  });

  it('skips unreviewed mappings when total is 0 (division by zero guard)', () => {
    const data = makeEmptyDiagnostics();
    data.unreviewedMappings = [
      { conceptId: 'test', total: 0, unreviewed: 0 },
    ];
    // Should not crash
    const suggestions = evaluateRules(data);
    expect(suggestions.filter((s) => s.type === 'mapping_unreviewed')).toHaveLength(0);
  });

  it('flags high acquire failure count as high priority', () => {
    const data = makeEmptyDiagnostics();
    data.acquireFailures = [
      { failureReason: 'network_timeout', count: 15 },
    ];
    const suggestions = evaluateRules(data);
    const failureSuggestions = suggestions.filter((s) => s.type === 'acquire_failures');
    expect(failureSuggestions).toHaveLength(1);
    expect(failureSuggestions[0]!.priority).toBe('high');
  });

  it('flags concept suggestions with source_paper_count >= 5 as high priority', () => {
    const data = makeEmptyDiagnostics();
    data.pendingSuggestions = [
      { term: 'social presence', sourcePaperCount: 9, reason: 'Found in many papers' },
    ];
    const suggestions = evaluateRules(data);
    const conceptSugs = suggestions.filter((s) => s.type === 'concept_suggestion');
    expect(conceptSugs).toHaveLength(1);
    expect(conceptSugs[0]!.priority).toBe('high');
  });

  it('flags maturity upgrade as low priority', () => {
    const data = makeEmptyDiagnostics();
    data.maturityUpgrades = [
      { id: 'affordance', nameEn: 'Affordance', maturity: 'tentative', mappedPapers: 8, avgConfidence: 0.75 },
    ];
    const suggestions = evaluateRules(data);
    const upgrades = suggestions.filter((s) => s.type === 'maturity_upgrade');
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]!.priority).toBe('low');
    expect(upgrades[0]!.action.operation).toBe('updateConceptMaturity');
  });

  it('flags unindexed memos as low priority', () => {
    const data = makeEmptyDiagnostics();
    data.unindexedMemoCount = 15;
    const suggestions = evaluateRules(data);
    const memoSugs = suggestions.filter((s) => s.type === 'unindexed_memos');
    expect(memoSugs).toHaveLength(1);
    expect(memoSugs[0]!.priority).toBe('low');
  });

  it('generates multiple suggestions for multiple issues', () => {
    const data = makeEmptyDiagnostics();
    data.conceptCoverage = [
      { conceptId: 'a', nameEn: 'A', maturity: 'tentative', mappedPapers: 0, reviewedPapers: 0 },
    ];
    data.acquireFailures = [
      { failureReason: 'timeout', count: 12 },
    ];
    data.unindexedMemoCount = 5;

    const suggestions = evaluateRules(data);
    expect(suggestions.length).toBeGreaterThanOrEqual(3);

    const types = new Set(suggestions.map((s) => s.type));
    expect(types.has('concept_coverage_low')).toBe(true);
    expect(types.has('acquire_failures')).toBe(true);
    expect(types.has('unindexed_memos')).toBe(true);
  });
});
