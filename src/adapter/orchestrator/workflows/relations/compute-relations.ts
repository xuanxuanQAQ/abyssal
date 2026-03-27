/**
 * Compute Relations — post-analysis incremental relation calculation adapter.
 *
 * Called after each paper completes analysis (Step 10).
 * Wraps the DAO computeRelationsForPaper with error handling and logging.
 *
 * The DAO already implements:
 * - Edge type derivation matrix (supports×supports→agree, supports×challenges→conflict, etc.)
 * - Weight formula: w = sqrt(c1 × c2) (geometric mean of confidences)
 * - Semantic neighbor KNN via abstract embedding
 *
 * L2 distance → similarity conversion note:
 * For L2-normalized vectors, d² ∈ [0, 4] and cosine = 1 - d²/2 ∈ [-1, 1].
 * Since UI and relation weights require [0, 1], we apply the affine transform:
 *   score = (cosine + 1) / 2 = 1 - d²/4
 * This is NOT an approximation — it is a mathematically exact Min-Max
 * normalization of cosine similarity from [-1, 1] to [0, 1].
 * Negative cosine (semantically opposite) maps to score < 0.5.
 *
 * See spec: §9
 */

import type { Logger } from '../../../../core/infra/logger';

// ─── DB interface for relation computation ───

export interface RelationComputeDb {
  /**
   * Compute all relations for a single paper.
   * Clears old relations, then rebuilds from concept mappings + semantic similarity.
   */
  computeRelationsForPaper: (
    paperId: string,
    semanticSearchFn: ((paperId: string, topK: number) => Array<{ paperId: string; score: number }>) | null,
  ) => void;
}

// ─── Semantic search adapter ───

export interface SemanticSearchAdapter {
  /**
   * Find papers semantically similar to the given paper's abstract.
   * Returns scored results sorted by similarity descending.
   */
  findSimilarPapers: (paperId: string, topK: number) => Promise<Array<{ paperId: string; score: number }>>;
}

// ─── Incremental relation computation (§9.1) ───

/**
 * Compute relations for a single paper after analysis completion.
 *
 * Safe to call multiple times (idempotent — clears and rebuilds).
 * Non-fatal: errors are logged but don't fail the analysis workflow.
 */
export function computeRelationsAfterAnalysis(
  paperId: string,
  db: RelationComputeDb,
  semanticSearch: SemanticSearchAdapter | null,
  logger: Logger,
): void {
  try {
    // Build a sync semantic search function for the DAO
    // TODO: semanticSearchFn depends on RagService KNN search.
    // When RagService is available, wrap its async search in a sync shim
    // or refactor DAO to accept async function.
    const semanticSearchFn = null; // Semantic neighbor computation deferred

    db.computeRelationsForPaper(paperId, semanticSearchFn);

    logger.debug('Relations computed', { paperId });
  } catch (err) {
    // Non-fatal — relations are a derived index, not primary data
    logger.warn(`Relation computation failed for ${paperId}`, {
      error: (err as Error).message,
    });
  }
}
