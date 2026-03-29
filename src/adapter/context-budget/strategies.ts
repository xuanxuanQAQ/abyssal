/**
 * Context budget strategies — Focused / Broad / Full parameter computation.
 *
 * Each strategy computes its budget using the universal formula from
 * budget-calculator.ts (§2.1), then applies strategy-specific caps
 * and RAG topK derivation formulas (§2.2-2.4).
 *
 * See spec: §1.1 (decision tree), §2.2-2.4 (strategy formulas)
 */

import {
  computeBudgetBreakdown,
  focusedBudgetCap,
  broadBudgetCap,
  fullBudgetCap,
  focusedRagTopK,
  broadRagTopK,
  fullRagTopK,
  shouldUpgradeToFull,
} from './budget-calculator';

// ─── Strategy mode ───

export type StrategyMode = 'focused' | 'broad' | 'full';

// ─── Strategy parameters interface ───

export interface StrategyParams {
  mode: StrategyMode;
  totalBudget: number;
  outputReserve: number;
  ragTopK: number;
  skipReranker: boolean;
  skipQueryExpansion: boolean;
}

// ─── Strategy computation ───

/**
 * Compute budget parameters for the Focused strategy (§2.2).
 *
 * Budget cap: min(40000, T_available)
 * RAG topK: 5 + floor((budget - 20000) / 5000), clamped [5, 10]
 */
export function focusedStrategy(windowSize: number): StrategyParams {
  const breakdown = computeBudgetBreakdown(windowSize);
  const totalBudget = focusedBudgetCap(breakdown.availableBudget);
  return {
    mode: 'focused',
    totalBudget,
    outputReserve: breakdown.outputReserve,
    ragTopK: focusedRagTopK(totalBudget),
    skipReranker: false,
    skipQueryExpansion: false,
  };
}

/**
 * Compute budget parameters for the Broad strategy (§2.3).
 *
 * Budget cap: min(90000, T_available)
 * RAG topK: 20 + floor((budget - 60000) / 3000), clamped [20, 50]
 */
export function broadStrategy(windowSize: number): StrategyParams {
  const breakdown = computeBudgetBreakdown(windowSize);
  const totalBudget = broadBudgetCap(breakdown.availableBudget);
  return {
    mode: 'broad',
    totalBudget,
    outputReserve: breakdown.outputReserve,
    ragTopK: broadRagTopK(totalBudget),
    skipReranker: false,
    skipQueryExpansion: false,
  };
}

/**
 * Compute budget parameters for the Full strategy (§2.4).
 *
 * Budget: T_available (no cap)
 * RAG topK: Infinity — all chunks injected
 * Skips reranker and query expansion (full injection eliminates retrieval loss).
 */
export function fullStrategy(windowSize: number): StrategyParams {
  const breakdown = computeBudgetBreakdown(windowSize);
  const totalBudget = fullBudgetCap(breakdown.availableBudget);
  return {
    mode: 'full',
    totalBudget,
    outputReserve: breakdown.outputReserve,
    ragTopK: fullRagTopK(),
    skipReranker: true,
    skipQueryExpansion: true,
  };
}

// ─── Strategy selection decision tree (§1.1) ───

export interface StrategySelectionParams {
  taskType: string;
  modelContextWindow: number;
  costPreference: string;
  totalEstimatedTokens: number;
  isAxiomSeed?: boolean;
  frameworkState?: string;
}

/**
 * Four-dimensional decision matrix (§1.1):
 * frameworkState × taskType × modelWindow × costPreference
 *
 * Decision tree evaluation order:
 * 1. taskType fast paths (ad_hoc, discover_screen)
 * 2. Full degradation check (content < 50% window)
 * 3. Per-taskType branching (analyze, synthesize, article)
 * 4. Fallback → focused
 */
export function selectStrategy(params: StrategySelectionParams): StrategyParams {
  const { taskType, modelContextWindow, totalEstimatedTokens, isAxiomSeed } = params;

  // ── Dimension 1: taskType fast path ──
  if (taskType === 'ad_hoc') {
    return focusedStrategy(modelContextWindow);
  }

  if (taskType === 'discover_screen') {
    return focusedStrategy(modelContextWindow); // screening always focused
  }

  // ── Dimension 2: full degradation check (before strategy selection) ──
  if (shouldUpgradeToFull(totalEstimatedTokens, modelContextWindow)) {
    return fullStrategy(modelContextWindow);
  }

  // ── Dimension 3: per-taskType branching ──
  if (taskType === 'analyze') {
    if (isAxiomSeed) {
      return broadStrategy(modelContextWindow); // axiom seed → broad
    }
    // Fix #8: zero_concepts needs more fulltext budget for concept discovery.
    // Skip focused cap when content fits within 80% of model window —
    // the saved concept_framework budget (~3000 tokens) goes to paper_fulltext.
    if (params.frameworkState === 'zero_concepts' &&
        totalEstimatedTokens < modelContextWindow * 0.8) {
      return fullStrategy(modelContextWindow);
    }
    return focusedStrategy(modelContextWindow);
  }

  if (taskType === 'synthesize' || taskType === 'article') {
    if (modelContextWindow >= 128_000) {
      return broadStrategy(modelContextWindow); // long window → broad
    }
    return focusedStrategy(modelContextWindow); // medium/short window → focused
  }

  // ── Fallback ──
  return focusedStrategy(modelContextWindow);
}
