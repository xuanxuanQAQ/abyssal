import { useState, useCallback, useRef, useEffect } from 'react';

interface CellPosition {
  row: number;
  col: number;
}

/**
 * Crosshair state management with RAF-throttled hover updates.
 *
 * Manages three independent position states:
 * - hoveredCell: tracks the cell under the mouse cursor (RAF-throttled)
 * - selectedCell: tracks the cell the user clicked on
 * - keyboardFocus: tracks the cell focused via keyboard navigation
 */
export function useCrosshair() {
  const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState<CellPosition | null>(null);

  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Cleanup any pending RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // RAF-throttled hover update: only the latest mouse position is evaluated per frame
  const scheduleHoverUpdate = useCallback(
    (
      hitTest: (
        x: number,
        y: number,
      ) => { row: number; col: number; isOnCell: boolean },
      x: number,
      y: number,
    ) => {
      pendingRef.current = { x, y };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const pos = pendingRef.current;
          if (!pos) return;
          const result = hitTest(pos.x, pos.y);
          if (result.isOnCell) {
            setHoveredCell({ row: result.row, col: result.col });
          } else {
            setHoveredCell(null);
          }
        });
      }
    },
    [],
  );

  const clearHover = useCallback(() => {
    pendingRef.current = null;
    setHoveredCell(null);
  }, []);

  const selectCell = useCallback((pos: CellPosition | null) => {
    setSelectedCell(pos);
  }, []);

  return {
    hoveredCell,
    selectedCell,
    keyboardFocus,
    setKeyboardFocus,
    scheduleHoverUpdate,
    clearHover,
    selectCell,
  } as const;
}
