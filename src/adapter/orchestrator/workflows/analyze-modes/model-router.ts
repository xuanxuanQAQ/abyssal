/**
 * Model Router — four-dimensional routing matrix for analyze workflow.
 *
 * Dimensions: relevance × paper_type × seed_type → mode + model selection
 *
 * Routes:
 *   'full'         → frontier model, full concept mapping
 *   'intermediate' → low-cost model, structured metadata extraction only
 *   'skip'         → no analysis (low/excluded relevance)
 *
 * See spec: §2
 */

// ─── Route result ───

export type AnalysisMode = 'full' | 'intermediate' | 'skip';

export interface RouteResult {
  mode: AnalysisMode;
  model: string;
  reason: string;
}

// ─── Config interface ───

export interface ModelRouterConfig {
  /** Frontier model for full analysis (default: resolved from config.llm.workflows.analyze) */
  frontierModel: string;
  /** Low-cost model for intermediate analysis */
  lowCostModel: string;
}

const DEFAULT_CONFIG: ModelRouterConfig = {
  frontierModel: 'claude-opus-4',
  lowCostModel: 'deepseek-chat',
};

// ─── Paper features for routing ───

export interface PaperFeatures {
  relevance: 'high' | 'medium' | 'low' | 'excluded';
  paperType: string;
  seedType: 'axiom' | 'milestone' | 'exploratory' | null;
}

// ─── Router (§2.1) ───

/**
 * Resolve the analysis mode and model for a paper based on its features.
 *
 * | relevance | paper_type              | seed_type | → mode + model           |
 * |-----------|-------------------------|-----------|--------------------------|
 * | high      | theoretical / review    | axiom     | full + frontier          |
 * | high      | theoretical / review    | *         | full + frontier          |
 * | high      | journal/conference/prep | *         | full + frontier          |
 * | medium    | *                       | *         | intermediate + low-cost  |
 * | low       | *                       | *         | skip                     |
 * | excluded  | *                       | *         | skip                     |
 */
export function resolveAnalysisRoute(
  features: PaperFeatures,
  config: Partial<ModelRouterConfig> = {},
): RouteResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Skip: low or excluded relevance
  if (features.relevance === 'low') {
    return { mode: 'skip', model: '', reason: 'low_relevance' };
  }
  if (features.relevance === 'excluded') {
    return { mode: 'skip', model: '', reason: 'excluded' };
  }

  // Intermediate: medium relevance → low-cost model
  if (features.relevance === 'medium') {
    return {
      mode: 'intermediate',
      model: cfg.lowCostModel,
      reason: 'medium_relevance_intermediate',
    };
  }

  // Full: high relevance → frontier model
  return {
    mode: 'full',
    model: cfg.frontierModel,
    reason: formatFullReason(features),
  };
}

function formatFullReason(features: PaperFeatures): string {
  const isTheoretical = features.paperType === 'theoretical' || features.paperType === 'review';
  const isAxiom = features.seedType === 'axiom';

  if (isTheoretical && isAxiom) return 'high_relevance_theoretical_axiom';
  if (isTheoretical) return 'high_relevance_theoretical';
  return 'high_relevance_standard';
}

/**
 * Check whether an intermediate analysis result recommends upgrade to full.
 */
export function shouldUpgradeIntermediate(
  intermediateResult: Record<string, unknown>,
): boolean {
  return intermediateResult['recommend_deep_analysis'] === true;
}
