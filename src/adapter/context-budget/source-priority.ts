/**
 * Source priority definitions — ten source types, four priority levels,
 * per-task mapping tables, and the priority-based trimming algorithm.
 *
 * See spec: §3 (ABSOLUTE injection), §4 (allocateByPriority three-phase trimming)
 */

// ─── Source types ───

export const SOURCE_TYPES = [
  'writing_instruction',
  'researcher_annotations',
  'researcher_memos',
  'synthesis_fragments',
  'rag_passages',
  'private_knowledge',
  'preceding_context',
  'paper_fulltext',
  'concept_framework',
  'analysis_template',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// ─── Priority levels ───

export const PRIORITIES = ['ABSOLUTE', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type SourcePriority = (typeof PRIORITIES)[number];

// ─── Per-task priority mappings ───

export type TaskType = 'analyze' | 'synthesize' | 'article' | 'ad_hoc' | 'discover_screen';

const ANALYZE_PRIORITIES: Partial<Record<SourceType, SourcePriority>> = {
  analysis_template:       'ABSOLUTE',
  concept_framework:       'ABSOLUTE',
  researcher_annotations:  'ABSOLUTE',
  researcher_memos:        'ABSOLUTE',
  paper_fulltext:          'HIGH',
  rag_passages:            'MEDIUM',
};

const SYNTHESIZE_PRIORITIES: Partial<Record<SourceType, SourcePriority>> = {
  concept_framework:       'ABSOLUTE',
  researcher_annotations:  'ABSOLUTE',
  researcher_memos:        'ABSOLUTE',
  rag_passages:            'HIGH',
  preceding_context:       'LOW',
};

const ARTICLE_PRIORITIES: Partial<Record<SourceType, SourcePriority>> = {
  writing_instruction:     'ABSOLUTE',
  researcher_annotations:  'ABSOLUTE',
  researcher_memos:        'ABSOLUTE',
  synthesis_fragments:     'HIGH',
  rag_passages:            'MEDIUM',
  private_knowledge:       'MEDIUM',
  preceding_context:       'LOW',
};

const AD_HOC_PRIORITIES: Partial<Record<SourceType, SourcePriority>> = {
  researcher_memos:        'ABSOLUTE',
  rag_passages:            'MEDIUM',
  concept_framework:       'LOW',
};

const DISCOVER_SCREEN_PRIORITIES: Partial<Record<SourceType, SourcePriority>> = {
  paper_fulltext:          'HIGH',
  concept_framework:       'MEDIUM',
};

const TASK_PRIORITY_MAPS: Record<TaskType, Partial<Record<SourceType, SourcePriority>>> = {
  analyze:         ANALYZE_PRIORITIES,
  synthesize:      SYNTHESIZE_PRIORITIES,
  article:         ARTICLE_PRIORITIES,
  ad_hoc:          AD_HOC_PRIORITIES,
  discover_screen: DISCOVER_SCREEN_PRIORITIES,
};

/**
 * Resolve the priority for a given source type in a given task context.
 * Returns 'LOW' if not explicitly mapped.
 */
export function getSourcePriority(taskType: TaskType, sourceType: SourceType): SourcePriority {
  return TASK_PRIORITY_MAPS[taskType]?.[sourceType] ?? 'LOW';
}

// ─── Source estimate (input to allocation) ───

export interface SourceEstimate {
  sourceType: SourceType;
  estimatedTokens: number;
  priority: SourcePriority;
  content: string | null;
}

// ─── Source allocation (output from allocation) ───

export interface SourceAllocation {
  sourceType: SourceType;
  budgetTokens: number;
  actualTokens: number;
  included: boolean;
  truncatedTo: number | null;
}

// ─── allocateByPriority three-phase trimming (§4) ───

/**
 * Allocate token budget across non-ABSOLUTE sources using priority-based trimming.
 *
 * Phase 1: Try to fit all — trim LOW proportionally if needed (§4.2)
 * Phase 2: Remove all LOW, trim MEDIUM proportionally (§4.3)
 * Phase 3: Remove LOW + MEDIUM, trim HIGH proportionally (§4.4)
 */
export function allocateByPriority(
  sources: SourceEstimate[],
  budget: number,
): SourceAllocation[] {
  if (sources.length === 0) return [];

  const high   = sources.filter((s) => s.priority === 'HIGH');
  const medium = sources.filter((s) => s.priority === 'MEDIUM');
  const low    = sources.filter((s) => s.priority === 'LOW');

  const totalRequested = sources.reduce((sum, s) => sum + s.estimatedTokens, 0);

  // All fit — no trimming needed
  if (totalRequested <= budget) {
    return sources.map((s) => ({
      sourceType: s.sourceType,
      budgetTokens: s.estimatedTokens,
      actualTokens: s.estimatedTokens,
      included: true,
      truncatedTo: null,
    }));
  }

  const highTotal   = high.reduce((sum, s) => sum + s.estimatedTokens, 0);
  const mediumTotal = medium.reduce((sum, s) => sum + s.estimatedTokens, 0);

  // Phase 1: Try removing some LOW to fit (§4.2)
  const withoutLow = highTotal + mediumTotal;
  if (withoutLow <= budget) {
    const lowBudget = budget - withoutLow;
    const lowAlloc = proportionalAllocate(low, lowBudget);
    return [
      ...fullAllocate(high),
      ...fullAllocate(medium),
      ...lowAlloc,
    ];
  }

  // Phase 2: Remove all LOW, trim MEDIUM (§4.3)
  if (highTotal <= budget) {
    const mediumBudget = budget - highTotal;
    const mediumAlloc = mediumBudget > 0
      ? proportionalAllocate(medium, mediumBudget)
      : excludeAll(medium);
    return [
      ...fullAllocate(high),
      ...mediumAlloc,
      ...excludeAll(low),
    ];
  }

  // Phase 3: Remove LOW + MEDIUM, trim HIGH (§4.4)
  const highAlloc = proportionalAllocate(high, budget);
  return [
    ...highAlloc,
    ...excludeAll(medium),
    ...excludeAll(low),
  ];
}

// ─── proportionalAllocate with surplus redistribution (§4.5) ───

/**
 * Proportionally allocate budget within same-priority sources.
 *
 * Three rounds:
 * 1. Initial proportional allocation: B_i = floor(T_i / sum(T_j) * budget)
 * 2. Surplus collection: sources needing less than allocated return surplus
 * 3. Surplus redistribution: deficit sources receive proportional extra budget
 */
export function proportionalAllocate(
  sources: SourceEstimate[],
  budget: number,
): SourceAllocation[] {
  if (sources.length === 0) return [];
  if (budget <= 0) return excludeAll(sources);

  const total = sources.reduce((sum, s) => sum + s.estimatedTokens, 0);
  if (total === 0) return excludeAll(sources);

  const allocations: SourceAllocation[] = sources.map((s) => ({
    sourceType: s.sourceType,
    budgetTokens: 0,
    actualTokens: s.estimatedTokens,
    included: true,
    truncatedTo: null,
  }));

  // Iterative surplus redistribution (up to 3 rounds)
  let remaining = budget;
  let remainingTotal = total;
  const settled = new Set<number>();

  for (let round = 0; round < 3; round++) {
    let surplusRedistributed = false;
    for (let i = 0; i < sources.length; i++) {
      if (settled.has(i)) continue;
      const s = sources[i]!;
      const share = remainingTotal > 0
        ? Math.floor((s.estimatedTokens / remainingTotal) * remaining)
        : 0;
      if (s.estimatedTokens <= share) {
        // Source needs less than its share — allocate exact, return surplus
        allocations[i]!.budgetTokens = s.estimatedTokens;
        allocations[i]!.truncatedTo = null;
        remaining -= s.estimatedTokens;
        remainingTotal -= s.estimatedTokens;
        settled.add(i);
        surplusRedistributed = true;
      } else {
        allocations[i]!.budgetTokens = share;
        allocations[i]!.truncatedTo = share;
      }
    }
    if (!surplusRedistributed) break;
  }

  // Final pass: distribute remaining budget to unsettled deficit sources
  const deficitIndices = sources
    .map((_, i) => i)
    .filter((i) => !settled.has(i));

  if (deficitIndices.length > 0 && remaining > 0) {
    const deficitTotal = deficitIndices.reduce(
      (sum, i) => sum + sources[i]!.estimatedTokens,
      0,
    );
    for (const i of deficitIndices) {
      const s = sources[i]!;
      const share = deficitTotal > 0
        ? Math.floor((s.estimatedTokens / deficitTotal) * remaining)
        : 0;
      const alloc = Math.min(share, s.estimatedTokens);
      allocations[i]!.budgetTokens = alloc;
      allocations[i]!.truncatedTo = alloc < s.estimatedTokens ? alloc : null;
      allocations[i]!.included = alloc > 0;
    }
  }

  return allocations;
}

// ─── Helpers ───

function fullAllocate(sources: SourceEstimate[]): SourceAllocation[] {
  return sources.map((s) => ({
    sourceType: s.sourceType,
    budgetTokens: s.estimatedTokens,
    actualTokens: s.estimatedTokens,
    included: true,
    truncatedTo: null,
  }));
}

function excludeAll(sources: SourceEstimate[]): SourceAllocation[] {
  return sources.map((s) => ({
    sourceType: s.sourceType,
    budgetTokens: 0,
    actualTokens: s.estimatedTokens,
    included: false,
    truncatedTo: null,
  }));
}
