/**
 * Context Budget Manager — allocates token budget across information sources.
 *
 * Four-dimensional decision matrix (§1.1):
 * frameworkState × taskType × modelWindow × costPreference
 *
 * Algorithm:
 * 1. Select strategy via decision tree
 * 2. Compute total budget using universal formula (§2.1)
 * 3. Precise ABSOLUTE source token counting with pre-deduction (§3.2)
 * 4. Three-phase priority-based trimming for non-ABSOLUTE sources (§4)
 * 5. RAG topK derivation per strategy formula (§2.2-2.4)
 * 6. Maturity-aware adjustment for tentative concepts (§1.3)
 * 7. frameworkState parameter tuning (§1.2)
 *
 * See spec: §1-4
 */

import {
  selectStrategy,
  type StrategyMode,
} from './strategies';
import {
  allocateByPriority,
  getSourcePriority,
  type SourceType,
  type SourceEstimate,
  type SourceAllocation,
  type TaskType,
} from './source-priority';
import { countTokens } from '../llm-client/token-counter';

// ─── Framework state type ───

export type FrameworkState = 'zero_concepts' | 'early_exploration' | 'framework_forming' | 'framework_mature';

// ─── Request / Response types ───

export interface BudgetRequest {
  taskType: TaskType;
  model: string;
  modelContextWindow: number;
  costPreference: 'aggressive' | 'balanced' | 'conservative';
  sources: SourceEstimate[];
  conceptMaturities: string[]; // 'tentative' | 'working' | 'established'
  isAxiomSeed?: boolean;
  frameworkState?: FrameworkState;
}

export interface TruncationDetail {
  sourceType: SourceType;
  originalTokens: number;
  truncatedTo: number;
}

export interface BudgetAllocation {
  strategy: StrategyMode;
  totalBudget: number;
  outputReserve: number;
  sourceAllocations: Map<SourceType, SourceAllocation>;
  ragTopK: number;
  skipReranker: boolean;
  skipQueryExpansion: boolean;
  truncated: boolean;
  truncationDetails: TruncationDetail[];
}

// ─── Logger interface ───

interface CBMLogger {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  debug?: (msg: string, ctx?: Record<string, unknown>) => void;
}

// ─── Context Budget Manager ───

export class ContextBudgetManager {
  private readonly logger: CBMLogger;

  constructor(logger: CBMLogger) {
    this.logger = logger;
  }

  /**
   * Allocate token budget for an LLM call.
   *
   * §1.1: Four-dimensional decision matrix
   * §3.2: ABSOLUTE token pre-deduction algorithm
   * §4:   Three-phase priority-based trimming
   * §1.2: frameworkState parameter tuning
   * §1.3: Maturity-aware RAG adjustment
   */
  allocate(request: BudgetRequest): BudgetAllocation {
    // Resolve priorities for each source based on task type
    const sources = request.sources.map((s) => ({
      ...s,
      priority: s.priority ?? getSourcePriority(request.taskType, s.sourceType),
    }));

    const totalEstimated = sources.reduce((sum, s) => sum + s.estimatedTokens, 0);

    // Step 1: Select strategy (§1.1 decision tree)
    const strategy = selectStrategy({
      taskType: request.taskType,
      modelContextWindow: request.modelContextWindow,
      costPreference: request.costPreference,
      totalEstimatedTokens: totalEstimated,
      ...(request.isAxiomSeed != null && { isAxiomSeed: request.isAxiomSeed }),
    });

    // Step 2: Compute budgets
    const totalBudget = strategy.totalBudget;
    const outputReserve = strategy.outputReserve;
    const availableBudget = totalBudget - outputReserve;

    // Step 3: Precise ABSOLUTE source token counting (§3.2)
    const absoluteSources = sources.filter((s) => s.priority === 'ABSOLUTE');
    const nonAbsoluteSources = sources.filter((s) => s.priority !== 'ABSOLUTE');

    const absoluteAllocations: SourceAllocation[] = [];
    let absoluteTotal = 0;

    for (const s of absoluteSources) {
      // Use precise token count when content is available, otherwise use estimate
      const actualTokens = s.content != null
        ? countTokens(s.content, request.model)
        : s.estimatedTokens;

      absoluteAllocations.push({
        sourceType: s.sourceType,
        budgetTokens: actualTokens,
        actualTokens,
        included: true,
        truncatedTo: null, // ABSOLUTE sources are never trimmed
      });
      absoluteTotal += actualTokens;
    }

    // §3.2 Step 3: ABSOLUTE overflow detection
    if (absoluteTotal > availableBudget) {
      this.logger.warn('ABSOLUTE sources exceed budget', {
        absoluteTokens: absoluteTotal,
        availableBudget,
        overflow: absoluteTotal - availableBudget,
      });
      // Do NOT trim ABSOLUTE — accept overflow.
      // Non-ABSOLUTE sources will receive 0 or minimal budget.
    }

    // Step 4: Compute remaining budget for non-ABSOLUTE (§3.2 Step 4)
    const remainingBudget = Math.max(0, availableBudget - absoluteTotal);

    // §1.2: frameworkState parameter tuning
    // zero_concepts → concept_framework budget = 0
    if (request.frameworkState === 'zero_concepts') {
      const cfIdx = nonAbsoluteSources.findIndex((s) => s.sourceType === 'concept_framework');
      if (cfIdx >= 0) {
        nonAbsoluteSources[cfIdx]!.estimatedTokens = 0;
      }
    }

    // Step 5: Allocate non-ABSOLUTE sources by priority (§4)
    const nonAbsAllocations = allocateByPriority(nonAbsoluteSources, remainingBudget);

    const allAllocations = [...absoluteAllocations, ...nonAbsAllocations];
    const sourceMap = new Map<SourceType, SourceAllocation>();
    for (const a of allAllocations) sourceMap.set(a.sourceType, a);

    // Collect truncation details
    const truncationDetails: TruncationDetail[] = [];
    for (const a of allAllocations) {
      if (a.truncatedTo !== null) {
        truncationDetails.push({
          sourceType: a.sourceType,
          originalTokens: a.actualTokens,
          truncatedTo: a.truncatedTo,
        });
      }
    }

    // Step 6: Determine RAG topK from strategy formula
    let ragTopK = strategy.ragTopK;

    // §1.2: early_exploration → ragTopK × 1.5
    if (request.frameworkState === 'early_exploration') {
      ragTopK = Math.ceil(ragTopK * 1.5);
    }

    // Step 7: Maturity-aware adjustment (§1.3)
    let skipReranker = strategy.skipReranker;
    let skipQueryExpansion = strategy.skipQueryExpansion;

    const hasTentative = request.conceptMaturities.some((m) => m === 'tentative');
    if (hasTentative) {
      ragTopK = Math.ceil(ragTopK * 1.5);
      skipReranker = false;
      skipQueryExpansion = false;
    }

    const allocation: BudgetAllocation = {
      strategy: strategy.mode,
      totalBudget,
      outputReserve,
      sourceAllocations: sourceMap,
      ragTopK,
      skipReranker,
      skipQueryExpansion,
      truncated: truncationDetails.length > 0,
      truncationDetails,
    };

    // §12.1: Debug-level decision log
    this.logger.debug?.('Budget allocation completed', {
      taskType: request.taskType,
      strategy: strategy.mode,
      modelWindow: request.modelContextWindow,
      totalBudget,
      outputReserve,
      absoluteTokens: absoluteTotal,
      remainingBudget,
      ragTopK,
      skipReranker,
      skipQueryExpansion,
      allocations: Object.fromEntries(
        [...sourceMap.entries()].map(([k, v]) => [
          k,
          { budget: v.budgetTokens, actual: v.actualTokens, truncated: v.truncatedTo !== null },
        ]),
      ),
      frameworkState: request.frameworkState ?? 'unknown',
      hasTentativeConcepts: hasTentative,
    });

    return allocation;
  }
}

// ─── Factory ───

export function createContextBudgetManager(logger: CBMLogger): ContextBudgetManager {
  return new ContextBudgetManager(logger);
}
