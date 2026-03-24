/**
 * [Δ-6] Velocity clamping safety valve + NaN sentinel (§4.4).
 */

export interface ClampResult {
  clamped: boolean;
  nanDetected: boolean;
  nanNodeIndices: number[];
}

/**
 * Compute the graph diameter as max(width, height) of the bounding box.
 */
export function computeGraphDiameter(
  positions: Float32Array,
  nodeCount: number,
): number {
  if (nodeCount === 0) return 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < nodeCount; i++) {
    const x = positions[i * 2]!;
    const y = positions[i * 2 + 1]!;

    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX)) return 0;

  return Math.max(maxX - minX, maxY - minY);
}

/**
 * Derive a safe maximum velocity from the graph diameter.
 */
export function computeMaxVelocity(graphDiameter: number): number {
  return graphDiameter * 0.1;
}

/**
 * Clamp per-node velocities to `maxVelocity` and reset NaN/Infinity positions
 * to the centroid of all valid nodes.
 *
 * For each node i (stride 2 in Float32Array):
 *   vx = positions[i*2] - previousPositions[i*2]
 *   vy = positions[i*2+1] - previousPositions[i*2+1]
 *
 *   - If NaN/Infinity detected: reset to centroid, record in nanNodeIndices
 *   - If speed > maxVelocity: scale velocity down to maxVelocity
 */
export function clampVelocities(
  positions: Float32Array,
  previousPositions: Float32Array,
  nodeCount: number,
  maxVelocity: number,
): ClampResult {
  const nanNodeIndices: number[] = [];
  let clamped = false;

  // First pass: compute centroid of all valid positions
  let sumX = 0;
  let sumY = 0;
  let validCount = 0;

  for (let i = 0; i < nodeCount; i++) {
    const x = positions[i * 2]!;
    const y = positions[i * 2 + 1]!;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      sumX += x;
      sumY += y;
      validCount++;
    }
  }

  const centroidX = validCount > 0 ? sumX / validCount : 0;
  const centroidY = validCount > 0 ? sumY / validCount : 0;

  // Second pass: fix NaN/Infinity and clamp velocities
  for (let i = 0; i < nodeCount; i++) {
    const xi = i * 2;
    const yi = i * 2 + 1;
    const x = positions[xi]!;
    const y = positions[yi]!;

    // NaN/Infinity check
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      positions[xi] = centroidX;
      positions[yi] = centroidY;
      nanNodeIndices.push(i);
      clamped = true;
      continue;
    }

    const vx = x - previousPositions[xi]!;
    const vy = y - previousPositions[yi]!;
    const speed = Math.sqrt(vx * vx + vy * vy);

    if (speed > maxVelocity) {
      const scale = maxVelocity / speed;
      positions[xi] = previousPositions[xi]! + vx * scale;
      positions[yi] = previousPositions[yi]! + vy * scale;
      clamped = true;
    }
  }

  return {
    clamped,
    nanDetected: nanNodeIndices.length > 0,
    nanNodeIndices,
  };
}
