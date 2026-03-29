// ═══ frameworkState 推导与模式切换 ═══
// §五: frameworkState 连续谱推导 + effectiveMode 计算

import type { ProjectMode } from '../types/config';
import type { ConceptDefinition } from '../types/concept';
import type { ConceptMaturity } from '../types/concept';

// ─── FrameworkState ───

export type FrameworkState =
  | 'zero_concepts'
  | 'early_exploration'
  | 'framework_forming'
  | 'framework_mature';

// ─── EffectiveMode ───

export type EffectiveMode = 'anchored' | 'unanchored' | 'unanchored_natural';

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

/**
 * §5.3: 根据配置 mode 和 frameworkState 计算运行时的有效模式。
 *
 * - unanchored：用户显式设置——即使有概念也不做锚定
 * - unanchored_natural：因为没有概念而自然退化为无锚定
 * - anchored：正常锚定模式
 * - auto：根据 frameworkState 自动判定
 */
export function effectiveMode(configMode: ProjectMode, frameworkState: FrameworkState): EffectiveMode {
  if (configMode === 'unanchored') return 'unanchored';

  // mode == 'anchored' 或 'auto'
  if (frameworkState === 'zero_concepts') return 'unanchored_natural';

  return 'anchored';
}
