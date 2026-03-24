/**
 * visibleRange — Compute the visible row/column range for canvas rendering.
 *
 * Uses uniform column stride and binary-searched row offsets
 * to determine which cells are within the viewport plus overscan margin.
 */

import { CELL_WIDTH, CELL_GAP } from '../layout/layoutConstants';
import { binarySearchRow } from './rowOffsets';

export interface VisibleRange {
  startCol: number;
  endCol: number;
  startRow: number;
  endRow: number;
}

/**
 * Compute the visible cell range given scroll state, viewport size, and overscan.
 *
 * @param scrollLeft     - Current horizontal scroll offset
 * @param scrollTop      - Current vertical scroll offset
 * @param viewportWidth  - Width of the visible viewport area
 * @param viewportHeight - Height of the visible viewport area
 * @param overscanX      - Extra horizontal pixels to render beyond the viewport
 * @param overscanY      - Extra vertical pixels to render beyond the viewport
 * @param numPapers      - Total number of paper columns
 * @param numConcepts    - Total number of concept rows
 * @param rowOffsets     - Precomputed Y offset for each row
 */
export function computeVisibleRange(
  scrollLeft: number,
  scrollTop: number,
  viewportWidth: number,
  viewportHeight: number,
  overscanX: number,
  overscanY: number,
  numPapers: number,
  numConcepts: number,
  rowOffsets: number[],
): VisibleRange {
  const stride = CELL_WIDTH + CELL_GAP;

  const startCol = Math.max(
    0,
    Math.floor((scrollLeft - overscanX) / stride),
  );
  const endCol = Math.min(
    numPapers - 1,
    Math.ceil((scrollLeft + viewportWidth + overscanX) / stride),
  );

  const startRow = Math.max(
    0,
    binarySearchRow(rowOffsets, scrollTop - overscanY),
  );
  const endRow = Math.min(
    numConcepts - 1,
    binarySearchRow(rowOffsets, scrollTop + viewportHeight + overscanY),
  );

  return { startCol, endCol, startRow, endRow };
}
