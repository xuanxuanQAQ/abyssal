import type { ConceptDefinition } from '../types/concept';
import {
  computeFrameworkState,
  deriveFrameworkState,
  computeConceptStats,
  effectiveMode,
} from './framework-state';

// ─── helpers ───

function makeConcept(
  overrides: Partial<ConceptDefinition> = {},
): ConceptDefinition {
  return {
    id: 'c-1' as any,
    nameZh: '概念',
    nameEn: 'Concept',
    layer: 'core',
    definition: 'def',
    searchKeywords: [],
    maturity: 'working',
    parentId: null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeN(
  n: number,
  maturity: 'tentative' | 'working' | 'established' = 'working',
): ConceptDefinition[] {
  return Array.from({ length: n }, (_, i) =>
    makeConcept({ id: `c-${i}` as any, maturity }),
  );
}

// ─── computeConceptStats ───

describe('computeConceptStats', () => {
  it('returns all zeros for empty array', () => {
    expect(computeConceptStats([])).toEqual({
      total: 0, tentative: 0, working: 0, established: 0,
    });
  });

  it('counts maturity distribution correctly', () => {
    const concepts = [
      makeConcept({ maturity: 'tentative' }),
      makeConcept({ maturity: 'tentative' }),
      makeConcept({ maturity: 'working' }),
      makeConcept({ maturity: 'established' }),
    ];
    expect(computeConceptStats(concepts)).toEqual({
      total: 4, tentative: 2, working: 1, established: 1,
    });
  });

  it('excludes deprecated concepts', () => {
    const concepts = [
      makeConcept({ maturity: 'working' }),
      makeConcept({ maturity: 'established', deprecated: true }),
    ];
    expect(computeConceptStats(concepts)).toEqual({
      total: 1, tentative: 0, working: 1, established: 0,
    });
  });

  it('defaults undefined maturity to working', () => {
    const c = makeConcept();
    (c as any).maturity = undefined;
    const stats = computeConceptStats([c]);
    expect(stats.working).toBe(1);
  });
});

// ─── deriveFrameworkState ───

describe('deriveFrameworkState', () => {
  it('zero total → zero_concepts', () => {
    expect(deriveFrameworkState({ total: 0, tentative: 0, working: 0, established: 0 }))
      .toBe('zero_concepts');
  });

  it('≤3 all tentative → early_exploration', () => {
    expect(deriveFrameworkState({ total: 1, tentative: 1, working: 0, established: 0 }))
      .toBe('early_exploration');
    expect(deriveFrameworkState({ total: 3, tentative: 3, working: 0, established: 0 }))
      .toBe('early_exploration');
  });

  it('3 concepts but not all tentative → framework_forming', () => {
    expect(deriveFrameworkState({ total: 3, tentative: 2, working: 1, established: 0 }))
      .toBe('framework_forming');
  });

  it('≥10 with ≥50% established → framework_mature', () => {
    expect(deriveFrameworkState({ total: 10, tentative: 0, working: 5, established: 5 }))
      .toBe('framework_mature');
    expect(deriveFrameworkState({ total: 12, tentative: 1, working: 2, established: 9 }))
      .toBe('framework_mature');
  });

  it('10 concepts but <50% established → framework_forming', () => {
    expect(deriveFrameworkState({ total: 10, tentative: 0, working: 6, established: 4 }))
      .toBe('framework_forming');
  });

  it('9 concepts with all established → framework_forming (not mature, need ≥10)', () => {
    expect(deriveFrameworkState({ total: 9, tentative: 0, working: 0, established: 9 }))
      .toBe('framework_forming');
  });

  it('4 all tentative → framework_forming (>3 threshold)', () => {
    expect(deriveFrameworkState({ total: 4, tentative: 4, working: 0, established: 0 }))
      .toBe('framework_forming');
  });
});

// ─── computeFrameworkState (integration of stats + derive) ───

describe('computeFrameworkState', () => {
  it('empty concepts → zero_concepts', () => {
    expect(computeFrameworkState([])).toBe('zero_concepts');
  });

  it('2 tentative → early_exploration', () => {
    expect(computeFrameworkState(makeN(2, 'tentative'))).toBe('early_exploration');
  });

  it('10 established → framework_mature', () => {
    expect(computeFrameworkState(makeN(10, 'established'))).toBe('framework_mature');
  });

  it('5 working → framework_forming', () => {
    expect(computeFrameworkState(makeN(5, 'working'))).toBe('framework_forming');
  });

  it('deprecated concepts are excluded from count', () => {
    const concepts = [
      ...makeN(3, 'tentative'),
      makeConcept({ maturity: 'established', deprecated: true }),
    ];
    // 3 tentative (all non-deprecated) → early_exploration
    expect(computeFrameworkState(concepts)).toBe('early_exploration');
  });
});

// ─── effectiveMode ───

describe('effectiveMode', () => {
  it('unanchored config → always unanchored regardless of state', () => {
    expect(effectiveMode('unanchored', 'zero_concepts')).toBe('unanchored');
    expect(effectiveMode('unanchored', 'early_exploration')).toBe('unanchored');
    expect(effectiveMode('unanchored', 'framework_mature')).toBe('unanchored');
  });

  it('anchored config + zero_concepts → unanchored_natural', () => {
    expect(effectiveMode('anchored', 'zero_concepts')).toBe('unanchored_natural');
  });

  it('anchored config + non-zero state → anchored', () => {
    expect(effectiveMode('anchored', 'early_exploration')).toBe('anchored');
    expect(effectiveMode('anchored', 'framework_forming')).toBe('anchored');
    expect(effectiveMode('anchored', 'framework_mature')).toBe('anchored');
  });

  it('auto config + zero_concepts → unanchored_natural', () => {
    expect(effectiveMode('auto', 'zero_concepts')).toBe('unanchored_natural');
  });

  it('auto config + non-zero state → anchored', () => {
    expect(effectiveMode('auto', 'early_exploration')).toBe('anchored');
    expect(effectiveMode('auto', 'framework_forming')).toBe('anchored');
    expect(effectiveMode('auto', 'framework_mature')).toBe('anchored');
  });
});
