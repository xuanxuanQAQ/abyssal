import { useCallback } from 'react';
import { CELL_WIDTH, CELL_GAP } from '../layout/layoutConstants';

/**
 * Column header hit detection.
 *
 * Converts a single horizontal mouse offset within the column-header container
 * to a column index, accounting for scroll position.
 */
export function useColumnHitTest(scrollLeft: number, numPapers: number) {
  const hitTest = useCallback(
    (offsetX: number): number => {
      const stride = CELL_WIDTH + CELL_GAP;
      const globalX = offsetX + scrollLeft;
      const col = Math.floor(globalX / stride);
      const colFraction = globalX - col * stride;

      // Only count as a hit when the cursor is on the cell body, not the gap
      if (col >= 0 && col < numPapers && colFraction < CELL_WIDTH) {
        return col;
      }
      return -1;
    },
    [scrollLeft, numPapers],
  );

  return hitTest;
}
