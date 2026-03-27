import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import type { HeatmapCell } from '../../../../../../shared-types/models';
import type { AdjudicationStatus, RelationType } from '../../../../../../shared-types/enums';
import {
  CELL_WIDTH,
  CELL_HEIGHT,
  CELL_GAP,
  OVERSCAN_FACTOR,
  REPAINT_THRESHOLD_RATIO,
} from '../layout/layoutConstants';
import { drawCell } from './cellRenderer';
import { drawCrosshair, drawSelectionBorder, drawKeyboardFocus } from './crosshairRenderer';
import { drawGridLines } from './gridLineRenderer';
import { computeVisibleRange } from '../data/visibleRange';

interface MatrixCanvasProps {
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
  cells: HeatmapCell[];
  cellLookup: Map<string, HeatmapCell>;
  numPapers: number;
  numConcepts: number;
  rowOffsets: number[];
  hoveredCell: { row: number; col: number } | null;
  selectedCell: { row: number; col: number } | null;
  keyboardFocus: { row: number; col: number } | null;
  showGrid: boolean;
  getAdjudicationStatus: (mappingId: string) => AdjudicationStatus;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

/**
 * Core heatmap canvas with overscan buffer, CSS transform scrolling,
 * and threshold-triggered repaint.
 *
 * Phase 1: On scroll, applies CSS transform for GPU-instant offset.
 * Phase 2: When scroll delta exceeds REPAINT_THRESHOLD, triggers full redraw.
 */
const MatrixCanvas: React.FC<MatrixCanvasProps> = ({
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
  cells,
  cellLookup,
  numPapers,
  numConcepts,
  rowOffsets,
  hoveredCell,
  selectedCell,
  keyboardFocus,
  showGrid,
  getAdjudicationStatus,
  onMouseMove,
  onMouseLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorScrollLeftRef = useRef(0);
  const anchorScrollTopRef = useRef(0);

  // Canvas dimensions include overscan buffer
  const canvasWidth = Math.ceil(viewportWidth * OVERSCAN_FACTOR);
  const canvasHeight = Math.ceil(viewportHeight * OVERSCAN_FACTOR);

  // Overscan margin: extra space on each side
  const overscanX = Math.floor((canvasWidth - viewportWidth) / 2);
  const overscanY = Math.floor((canvasHeight - viewportHeight) / 2);

  // Repaint thresholds in pixels
  const repaintThresholdX = Math.floor(viewportWidth * REPAINT_THRESHOLD_RATIO);
  const repaintThresholdY = Math.floor(viewportHeight * REPAINT_THRESHOLD_RATIO);

  // HiDPI device pixel ratio
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

  const colStride = CELL_WIDTH + CELL_GAP;
  const rowStride = CELL_HEIGHT + CELL_GAP;

  // Detect dark mode from media query
  const isDark = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, []);

  /**
   * Convert a cell grid position (row, col) to canvas-local pixel coordinates,
   * relative to the anchor scroll position.
   */
  const cellToCanvas = useCallback(
    (row: number, col: number): { cx: number; cy: number } => {
      const worldX = col * colStride;
      const worldY = row < rowOffsets.length ? rowOffsets[row]! : row * rowStride;
      const cx = worldX - anchorScrollLeftRef.current + overscanX;
      const cy = worldY - anchorScrollTopRef.current + overscanY;
      return { cx, cy };
    },
    [colStride, rowStride, overscanX, overscanY, rowOffsets],
  );

  /**
   * Full repaint: clears canvas, draws all visible cells, overlays, and grid.
   */
  const repaint = useCallback(
    (anchorLeft: number, anchorTop: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Update anchor refs
      anchorScrollLeftRef.current = anchorLeft;
      anchorScrollTopRef.current = anchorTop;

      // Clear entire canvas
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // Compute visible range based on anchor position (with overscan)
      const visibleAnchorLeft = anchorLeft - overscanX;
      const visibleAnchorTop = anchorTop - overscanY;
      const visibleWidth = canvasWidth;
      const visibleHeight = canvasHeight;

      const { startRow, endRow, startCol, endCol } = computeVisibleRange(
        visibleAnchorLeft,
        visibleAnchorTop,
        visibleWidth,
        visibleHeight,
        overscanX,
        overscanY,
        numPapers,
        numConcepts,
        rowOffsets,
      );

      // Draw visible cells
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const lookupKey = `${r}:${c}`;
          const cell = cellLookup.get(lookupKey);
          if (!cell) continue;

          const { cx, cy } = cellToCanvas(r, c);
          const adjStatus = getAdjudicationStatus(cell.mappingId);
          drawCell(ctx, cx, cy, cell.relationType, cell.confidence, adjStatus);
        }
      }

      // Draw grid lines if enabled
      if (showGrid) {
        drawGridLines(
          ctx,
          canvasWidth,
          canvasHeight,
          startCol,
          endCol,
          startRow,
          endRow,
          anchorLeft,
          anchorTop,
          overscanX,
          overscanY,
          rowOffsets,
        );
      }

      // Draw crosshair for hovered cell
      if (hoveredCell) {
        const { cx, cy } = cellToCanvas(hoveredCell.row, hoveredCell.col);
        drawCrosshair(ctx, canvasWidth, canvasHeight, cx, cy, isDark);
      }

      // Draw selection border
      if (selectedCell) {
        const { cx, cy } = cellToCanvas(selectedCell.row, selectedCell.col);
        drawSelectionBorder(ctx, cx, cy);
      }

      // Draw keyboard focus ring
      if (keyboardFocus) {
        const { cx, cy } = cellToCanvas(keyboardFocus.row, keyboardFocus.col);
        drawKeyboardFocus(ctx, cx, cy);
      }

      ctx.restore();
    },
    [
      dpr,
      overscanX,
      overscanY,
      canvasWidth,
      canvasHeight,
      numConcepts,
      numPapers,
      rowOffsets,
      cellLookup,
      cellToCanvas,
      getAdjudicationStatus,
      showGrid,
      hoveredCell,
      selectedCell,
      keyboardFocus,
      isDark,
    ],
  );

  // Phase 2: Full repaint on hover/select/keyboardFocus change
  useEffect(() => {
    repaint(anchorScrollLeftRef.current, anchorScrollTopRef.current);
  }, [hoveredCell, selectedCell, keyboardFocus, cells, showGrid, repaint]);

  // Phase 1 & 2: Scroll handling with CSS transform + threshold repaint
  useEffect(() => {
    const deltaX = scrollLeft - anchorScrollLeftRef.current;
    const deltaY = scrollTop - anchorScrollTopRef.current;

    const needsRepaint =
      Math.abs(deltaX) > repaintThresholdX || Math.abs(deltaY) > repaintThresholdY;

    if (needsRepaint) {
      // Phase 2: full redraw with new anchor
      repaint(scrollLeft, scrollTop);
    }
    // Phase 1 CSS transform is applied via style below
  }, [scrollLeft, scrollTop, repaintThresholdX, repaintThresholdY, repaint]);

  // Set up HiDPI canvas on mount / resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = Math.floor(canvasWidth * dpr);
    canvas.height = Math.floor(canvasHeight * dpr);

    // Initial paint
    repaint(scrollLeft, scrollTop);
  }, [canvasWidth, canvasHeight, dpr]);

  // Compute CSS transform offset for smooth scrolling (Phase 1)
  const deltaX = scrollLeft - anchorScrollLeftRef.current;
  const deltaY = scrollTop - anchorScrollTopRef.current;
  const translateX = Math.floor(-overscanX - deltaX);
  const translateY = Math.floor(-overscanY - deltaY);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        width: canvasWidth,
        height: canvasHeight,
        transform: `translate(${translateX}px, ${translateY}px)`,
        willChange: 'transform',
        pointerEvents: 'auto',
        imageRendering: 'pixelated',
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    />
  );
};

export default MatrixCanvas;
