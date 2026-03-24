import { useCallback } from 'react';
import { CELL_WIDTH, CELL_HEIGHT, CELL_GAP } from '../layout/layoutConstants';
import { binarySearchRow } from '../data/rowOffsets';

interface HitTestResult {
  row: number;
  col: number;
  isOnCell: boolean;
}

/**
 * Mouse coordinate -> cell (row, col) conversion with overscan + CSS transform offset correction.
 *
 * Canvas-local pixel coordinates are converted back to global matrix coordinates
 * by accounting for the anchor scroll position, overscan padding, and accumulated
 * CSS-transform delta that has not yet triggered a full repaint.
 */
export function useCellHitTest(
  rowOffsets: number[],
  numPapers: number,
  numConcepts: number,
  anchorScrollLeft: number,
  anchorScrollTop: number,
  overscanX: number,
  overscanY: number,
  deltaX: number,
  deltaY: number,
) {
  const hitTest = useCallback(
    (offsetX: number, offsetY: number): HitTestResult => {
      const stride = CELL_WIDTH + CELL_GAP;

      // Convert canvas-local coords to global matrix coords
      const globalX = offsetX + anchorScrollLeft - overscanX + deltaX;
      const globalY = offsetY + anchorScrollTop - overscanY + deltaY;

      const col = Math.floor(globalX / stride);
      const colFraction = globalX - col * stride;
      const isInCellX = colFraction >= 0 && colFraction < CELL_WIDTH;

      if (rowOffsets.length === 0) {
        return { row: -1, col: -1, isOnCell: false };
      }

      const row = binarySearchRow(rowOffsets, globalY);
      const rowTop = rowOffsets[row] ?? 0;
      const rowFraction = globalY - rowTop;
      const isInCellY = rowFraction >= 0 && rowFraction < CELL_HEIGHT;

      const isOnCell =
        isInCellX &&
        isInCellY &&
        col >= 0 &&
        col < numPapers &&
        row >= 0 &&
        row < numConcepts;

      return {
        row: isOnCell ? row : -1,
        col: isOnCell ? col : -1,
        isOnCell,
      };
    },
    [
      rowOffsets,
      numPapers,
      numConcepts,
      anchorScrollLeft,
      anchorScrollTop,
      overscanX,
      overscanY,
      deltaX,
      deltaY,
    ],
  );

  return hitTest;
}
