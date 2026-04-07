/**
 * Maturity Evaluator — per-maturity parameter rules for prompt/RAG/output.
 *
 * Returns differentiated parameters based on concept maturity distribution:
 * - tentative: aggressive RAG, low confidence expected, active concept discovery
 * - working: standard parameters
 * - established: focus on evidence quality, minimal concept discovery
 *
 * See spec: §4
 */

// ─── Maturity parameters ───

export interface MaturityParams {
  /** Expected confidence range description for prompt */
  confidenceHint: string;
  /** RAG query variant count (more for tentative) */
  queryVariantCount: number;
  /** Whether suggested_new_concepts should be actively requested */
  activeSuggestionDiscovery: boolean;
  /** Evidence depth requirement description */
  evidenceDepthHint: string;
}

/**
 * Resolve maturity-driven parameters for the concept set.
 *
 * Uses the "most tentative" concept's maturity to set the overall tone,
 * since tentative concepts need the most attention.
 */
export function resolveMaturityParams(
  maturities: Array<'tag' | 'tentative' | 'working' | 'established'>,
): MaturityParams {
  // tag 级概念不参与分析参数决策
  const active = maturities.filter((m) => m !== 'tag');
  const hasTentative = active.includes('tentative');
  const hasWorking = active.includes('working');

  if (hasTentative) {
    return {
      confidenceHint: 'Low confidence (0.2-0.6) is expected and acceptable for tentative concepts.',
      queryVariantCount: 4, // all search_keywords generate independent queries
      activeSuggestionDiscovery: true,
      evidenceDepthHint: 'Brief evidence is acceptable — the paper may only be indirectly related.',
    };
  }

  if (hasWorking) {
    return {
      confidenceHint: 'Standard confidence range (0.3-0.8).',
      queryVariantCount: 3,
      activeSuggestionDiscovery: true,
      evidenceDepthHint: 'Standard evidence depth — include relevant quotes or descriptions.',
    };
  }

  // All established
  return {
    confidenceHint: 'High confidence (0.5-0.95) is expected for established concepts.',
    queryVariantCount: 2,
    activeSuggestionDiscovery: false,
    evidenceDepthHint: 'Detailed evidence required — include specific page/section references.',
  };
}

// ─── Maturity-specific prompt instruction builder ───

/**
 * Build maturity-specific instructions to append to system prompt.
 *
 * Only generated when tentative or established concepts are present,
 * since working concepts use standard behavior.
 */
export function buildMaturityInstructions(
  maturities: Array<'tag' | 'tentative' | 'working' | 'established'>,
): string {
  const params = resolveMaturityParams(maturities);
  const lines: string[] = [];

  if (maturities.includes('tentative')) {
    lines.push('## Maturity-Aware Analysis Notes');
    lines.push('');
    lines.push('Some concepts in this framework are marked TENTATIVE. For these:');
    lines.push(`- ${params.confidenceHint}`);
    lines.push(`- ${params.evidenceDepthHint}`);
    lines.push('- Actively suggest alternative conceptualizations in `suggested_new_concepts`.');
    lines.push('');
  }

  if (maturities.includes('established') && !maturities.includes('tentative')) {
    lines.push('## Maturity-Aware Analysis Notes');
    lines.push('');
    lines.push('The concepts in this framework are well-established. Focus on:');
    lines.push(`- ${params.confidenceHint}`);
    lines.push(`- ${params.evidenceDepthHint}`);
    lines.push('- New concept suggestions are only needed if the paper introduces genuinely novel constructs.');
    lines.push('');
  }

  return lines.join('\n');
}
