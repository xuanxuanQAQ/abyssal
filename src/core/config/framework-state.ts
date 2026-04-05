// ═══ frameworkState 推导 ═══
// §五: frameworkState 连续谱推导

import type { ConceptDefinition } from '../types/concept';
import type { ConceptMaturity } from '../types/concept';

// ─── FrameworkState ───

export type FrameworkState =
  | 'zero_concepts'
  | 'early_exploration'
  | 'framework_forming'
  | 'framework_mature';

// ─── 推导 ───

export interface ConceptStats {
  total: number;
  tentative: number;
  working: number;
  established: number;
}

/**
 * 从概念列表推导 frameworkState。
 *
 * 规则：
 * - 0 concepts → zero_concepts
 * - ≤3 concepts 且全部 tentative → early_exploration
 * - ≥10 concepts 且 established ≥50% → framework_mature
 * - 其余 → framework_forming
 */
export function computeFrameworkState(concepts: ConceptDefinition[]): FrameworkState {
  const stats = computeConceptStats(concepts);
  return deriveFrameworkState(stats);
}

/**
 * 从已汇总的概念统计推导 frameworkState（兼容 AppContext.refreshFrameworkState）。
 */
export function deriveFrameworkState(stats: ConceptStats): FrameworkState {
  const { total, tentative, established } = stats;

  if (total === 0) return 'zero_concepts';
  if (total <= 3 && tentative === total) return 'early_exploration';
  if (established >= total * 0.5 && total >= 10) return 'framework_mature';
  return 'framework_forming';
}

/**
 * 统计概念的 maturity 分布。
 */
export function computeConceptStats(concepts: ConceptDefinition[]): ConceptStats {
  let tentative = 0;
  let working = 0;
  let established = 0;

  for (const c of concepts) {
    if (c.deprecated) continue;
    const m: ConceptMaturity = c.maturity ?? 'working';
    if (m === 'tentative') tentative++;
    else if (m === 'working') working++;
    else if (m === 'established') established++;
  }

  return {
    total: tentative + working + established,
    tentative,
    working,
    established,
  };
}
