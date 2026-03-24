/**
 * rowOffsets — Pure functions for row offset computation.
 *
 * Computes Y positions for each concept row, accounting for
 * group boundaries that insert extra CONCEPT_GROUP_GAP spacing.
 */

import { CELL_HEIGHT, CELL_GAP, CONCEPT_GROUP_GAP } from '../layout/layoutConstants';

/**
 * Compute the Y offset of each concept row.
 * Group boundaries insert extra vertical gap between groups.
 */
export function computeRowOffsets(
  numConcepts: number,
  groupBoundaries: Set<number>,
): number[] {
  const offsets = new Array<number>(numConcepts);
  let y = 0;
  for (let i = 0; i < numConcepts; i++) {
    if (i > 0 && groupBoundaries.has(i)) {
      y += CONCEPT_GROUP_GAP;
    }
    offsets[i] = y;
    y += CELL_HEIGHT + CELL_GAP;
  }
  return offsets;
}

/**
 * Binary search for the row index at a given Y coordinate.
 * Returns the index of the last row whose offset is <= targetY.
 */
export function binarySearchRow(rowOffsets: number[], targetY: number): number {
  let lo = 0;
  let hi = rowOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (rowOffsets[mid]! <= targetY) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Compute the total content height from row offsets.
 */
export function computeTotalHeight(
  rowOffsets: number[],
  numConcepts: number,
): number {
  if (numConcepts === 0) return 0;
  return rowOffsets[numConcepts - 1]! + CELL_HEIGHT + CELL_GAP;
}
