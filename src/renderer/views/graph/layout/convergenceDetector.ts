/**
 * Global speed convergence detection (§4.5).
 */

export const CONVERGENCE_THRESHOLD = 1.0;
export const STABILITY_THRESHOLD = 0.1;

export interface ConvergenceState {
  globalSpeed: number;
  isConverged: boolean;
  isFullyStable: boolean;
}

/**
 * Compute global speed as the RMS displacement across all nodes.
 *
 * globalSpeed = sqrt(sum((x_new - x_old)^2 + (y_new - y_old)^2) / nodeCount)
 */
export function computeGlobalSpeed(
  positions: Float32Array,
  previousPositions: Float32Array,
  nodeCount: number,
): number {
  if (nodeCount === 0) return 0;

  let sumSquared = 0;
  for (let i = 0; i < nodeCount; i++) {
    const dx = positions[i * 2]! - previousPositions[i * 2]!;
    const dy = positions[i * 2 + 1]! - previousPositions[i * 2 + 1]!;
    sumSquared += dx * dx + dy * dy;
  }

  return Math.sqrt(sumSquared / nodeCount);
}

/**
 * Classify the current global speed into a convergence state.
 *
 * - > 10.0: high speed, not converged
 * - 1.0–10.0: converging
 * - < 1.0: converged (isConverged = true)
 * - < 0.1: fully stable (isFullyStable = true)
 */
export function detectConvergence(globalSpeed: number): ConvergenceState {
  return {
    globalSpeed,
    isConverged: globalSpeed < CONVERGENCE_THRESHOLD,
    isFullyStable: globalSpeed < STABILITY_THRESHOLD,
  };
}
