/**
 * Budget Calculator — universal budget formulas for context window allocation.
 *
 * T_window    = modelContextWindow
 * T_output    = max(4096, T_window × 0.15)       — output reserve (15%)
 * T_safety    = T_window × 0.15                   — safety margin (token counting error + template overhead)
 * T_available = T_window - T_output - T_safety    — usable input budget (≈ 70%)
 *
 * See spec: §2.1
 */

// ─── Core budget computation ───

export interface BudgetBreakdown {
  windowSize: number;
  outputReserve: number;
  safetyMargin: number;
  availableBudget: number;
}

/**
 * Compute the universal budget breakdown for a given model context window.
 *
 * Output reserve (15%, min 4096): guarantees sufficient output space across
 * all workflow scenarios (analyze ~4K, synthesize ~2K, article ~3K tokens).
 *
 * Safety margin (15%): covers tokenizer approximation error (<8% for CJK with
 * cl100k_base) plus template instruction fixed overhead (~800-1500 tokens).
 */
export function computeBudgetBreakdown(windowSize: number): BudgetBreakdown {
  const outputReserve = Math.max(4096, Math.floor(windowSize * 0.15));
  const safetyMargin = Math.floor(windowSize * 0.15);
  const availableBudget = windowSize - outputReserve - safetyMargin;

  return {
    windowSize,
    outputReserve,
    safetyMargin,
    availableBudget: Math.max(0, availableBudget),
  };
}

// ─── Per-strategy budget caps ───

/**
 * Compute capped total budget for the Focused strategy.
 * Cap: min(40000, T_available)
 */
export function focusedBudgetCap(availableBudget: number): number {
  return Math.min(40_000, availableBudget);
}

/**
 * Compute capped total budget for the Broad strategy.
 * Cap: min(90000, T_available)
 */
export function broadBudgetCap(availableBudget: number): number {
  return Math.min(90_000, availableBudget);
}

/**
 * Full strategy uses all available budget — no cap.
 */
export function fullBudgetCap(availableBudget: number): number {
  return availableBudget;
}

// ─── RAG topK derivation ───

/**
 * Derive RAG topK for Focused strategy.
 *
 * Formula: 5 + floor((totalBudget - 20000) / 5000), clamped to [5, 10]
 *
 * | totalBudget | ragTopK | rationale              |
 * |-------------|---------|------------------------|
 * | 20000       | 5       | minimum — most relevant |
 * | 30000       | 7       | moderate expansion      |
 * | 40000       | 9       | near ceiling            |
 * | 40000+      | 10      | capped for Focused      |
 */
export function focusedRagTopK(totalBudget: number): number {
  const raw = 5 + Math.floor((totalBudget - 20_000) / 5000);
  return Math.max(5, Math.min(10, raw));
}

/**
 * Derive RAG topK for Broad strategy.
 *
 * Formula: 20 + floor((totalBudget - 60000) / 3000), clamped to [20, 50]
 *
 * | totalBudget | ragTopK | rationale            |
 * |-------------|---------|----------------------|
 * | 60000       | 20      | Broad minimum        |
 * | 75000       | 25      | standard Broad       |
 * | 90000       | 30      | maximum Broad        |
 */
export function broadRagTopK(totalBudget: number): number {
  const raw = 20 + Math.floor((totalBudget - 60_000) / 3000);
  return Math.max(20, Math.min(50, raw));
}

/**
 * Full strategy: unlimited topK — all chunks injected.
 */
export function fullRagTopK(): number {
  return Infinity;
}

// ─── Upgrade-to-full threshold ───

/**
 * Check whether content is small enough to warrant Full strategy upgrade.
 *
 * Threshold: totalEstimated < modelContextWindow × 0.5
 *
 * After full injection, 50% window remains: 15% output + 15% safety + 20% margin.
 * The 20% margin prevents tokenizer estimation errors from causing truncation.
 */
export function shouldUpgradeToFull(
  totalEstimatedTokens: number,
  modelContextWindow: number,
): boolean {
  return totalEstimatedTokens < modelContextWindow * 0.5;
}
