import { useCallback, useEffect } from 'react';

interface CellPosition {
  row: number;
  col: number;
}

interface UseKeyboardNavOptions {
  numRows: number;
  numCols: number;
  keyboardFocus: CellPosition | null;
  setKeyboardFocus: (pos: CellPosition | null) => void;
  onSelect: (row: number, col: number) => void;
  onQuickAccept: (row: number, col: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Keyboard navigation for the heatmap canvas.
 *
 * - Arrow keys: move keyboard focus between cells
 * - Enter: select the focused cell (equivalent to click)
 * - Space: quick-accept the focused cell's mapping
 * - Escape: clear selection and keyboard focus
 * - Tab: left to browser default behavior
 */
export function useKeyboardNav(options: UseKeyboardNavOptions) {
  const {
    numRows,
    numCols,
    keyboardFocus,
    setKeyboardFocus,
    onSelect,
    onQuickAccept,
    containerRef,
  } = options;

  const clamp = useCallback(
    (row: number, col: number): CellPosition => ({
      row: Math.max(0, Math.min(row, numRows - 1)),
      col: Math.max(0, Math.min(col, numCols - 1)),
    }),
    [numRows, numCols],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle when our container (or a descendant) has focus
      if (!containerRef.current?.contains(e.target as Node)) return;

      // Ignore if grid is empty
      if (numRows === 0 || numCols === 0) return;

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault();
          if (keyboardFocus === null) {
            setKeyboardFocus({ row: 0, col: 0 });
          } else {
            setKeyboardFocus(clamp(keyboardFocus.row - 1, keyboardFocus.col));
          }
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          if (keyboardFocus === null) {
            setKeyboardFocus({ row: 0, col: 0 });
          } else {
            setKeyboardFocus(clamp(keyboardFocus.row + 1, keyboardFocus.col));
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (keyboardFocus === null) {
            setKeyboardFocus({ row: 0, col: 0 });
          } else {
            setKeyboardFocus(clamp(keyboardFocus.row, keyboardFocus.col - 1));
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (keyboardFocus === null) {
            setKeyboardFocus({ row: 0, col: 0 });
          } else {
            setKeyboardFocus(clamp(keyboardFocus.row, keyboardFocus.col + 1));
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (keyboardFocus !== null) {
            onSelect(keyboardFocus.row, keyboardFocus.col);
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (keyboardFocus !== null) {
            onQuickAccept(keyboardFocus.row, keyboardFocus.col);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setKeyboardFocus(null);
          break;
        }
        default:
          break;
      }
    },
    [numRows, numCols, keyboardFocus, setKeyboardFocus, onSelect, onQuickAccept, clamp, containerRef],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, containerRef]);
}
