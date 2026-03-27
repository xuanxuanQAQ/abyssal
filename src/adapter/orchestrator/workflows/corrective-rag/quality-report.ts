/**
 * QualityReport — structured output from CRAG evaluation loop.
 *
 * Captures three-dimensional assessment (coverage/relevance/sufficiency),
 * evidence gaps, and repair actions taken during the loop.
 *
 * See spec: §1.6
 */

// ─── Evidence gap ───

export interface EvidenceGap {
  description: string;
  suggestedAction: string;
  severity: 'critical' | 'moderate' | 'minor';
}

// ─── Quality report ───

export interface QualityReport {
  coverage: 'sufficient' | 'partial' | 'insufficient';
  relevance: 'high' | 'moderate' | 'low';
  sufficiency: 'sufficient' | 'partial' | 'insufficient';
  gaps: EvidenceGap[];
  retryCount: number;
  queryRewritten: boolean;
  rewrittenQuery: string | null;
  topKExpanded: boolean;
  scoreThresholdRaised: boolean;
}

// ─── Evaluation result (from LLM) ───

export interface EvaluationResult {
  coverage: 'sufficient' | 'partial' | 'insufficient';
  relevance: 'high' | 'moderate' | 'low';
  sufficiency: 'sufficient' | 'insufficient';
  suggestedQuery: string | null;
  suggestedFilter: string | null;
  gaps: string[];
}

/**
 * Build a QualityReport from the final evaluation and loop metadata.
 */
export function buildQualityReport(
  evaluation: EvaluationResult,
  retryCount: number,
  allGaps: string[],
  actions: { queryRewritten: boolean; rewrittenQuery: string | null; topKExpanded: boolean; scoreThresholdRaised: boolean },
): QualityReport {
  const dedupedGaps = [...new Set(allGaps)];

  return {
    coverage: evaluation.coverage,
    relevance: evaluation.relevance,
    sufficiency: evaluation.sufficiency === 'insufficient' ? 'insufficient' : 'sufficient',
    gaps: dedupedGaps.map((desc) => ({
      description: desc,
      suggestedAction: '',
      severity: 'moderate' as const,
    })),
    retryCount,
    queryRewritten: actions.queryRewritten,
    rewrittenQuery: actions.rewrittenQuery,
    topKExpanded: actions.topKExpanded,
    scoreThresholdRaised: actions.scoreThresholdRaised,
  };
}

/**
 * Check if a quality report indicates evidence is insufficient
 * and should trigger evidenceGaps injection in prompt.
 */
export function hasEvidenceDeficiency(report: QualityReport): boolean {
  return report.coverage === 'insufficient' || report.sufficiency === 'insufficient';
}

/**
 * Default pass-through report when CRAG is disabled or skipped.
 */
export function defaultPassReport(): QualityReport {
  return {
    coverage: 'sufficient',
    relevance: 'high',
    sufficiency: 'sufficient',
    gaps: [],
    retryCount: 0,
    queryRewritten: false,
    rewrittenQuery: null,
    topKExpanded: false,
    scoreThresholdRaised: false,
  };
}
