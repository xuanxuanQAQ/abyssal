/**
 * HeatmapGrid — CSS Grid 4-quadrant container
 *
 * Exports layout constants used by canvas, data, and header components.
 * Grid template: ROW_HEADER_WIDTH | 1fr  x  COLUMN_HEADER_HEIGHT | 1fr
 * Children: CornerCell, ColumnHeader, RowHeader, MatrixViewport.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { CornerCell } from './CornerCell';
import { ColumnHeader } from './ColumnHeader';
import { RowHeader } from './RowHeader';
import { MatrixViewport } from './MatrixViewport';
import MatrixCanvas from '../canvas/MatrixCanvas';
import type { HeatmapCell } from '../../../../../../shared-types/models';
import { cellKey } from '../../../shared/cellKey';
import {
  CELL_WIDTH,
  CELL_HEIGHT,
  CELL_GAP,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
} from './layoutConstants';
import { binarySearchRow } from '../data/rowOffsets';

// ── Props ──

interface ConceptInfo {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
}

interface ConceptGroup {
  id: string;
  name: string;
  conceptIds: string[];
}

interface HeatmapGridProps {
  paperIds: string[];
  paperLabels: string[];
  concepts: ConceptInfo[];
  groups: ConceptGroup[];
  collapsedGroups: Set<string>;
  onToggleGroup: (groupId: string) => void;
  hoveredCell: { row: number; col: number } | null;
  selectedCell: { row: number; col: number } | null;
  onHoverCell: (cell: { row: number; col: number } | null) => void;
  onHoverPositionChange: (position: { x: number; y: number } | null) => void;
  onSelectCell: (cell: { row: number; col: number } | null) => void;
  onOpenCellMenu: (
    cell: { row: number; col: number } | null,
    position: { x: number; y: number } | null,
  ) => void;
  showGrid: boolean;
  rowOffsets: number[];
  totalContentHeight: number;
  cellLookup: Map<string, HeatmapCell>;
}

export function HeatmapGrid({
  paperIds,
  paperLabels,
  concepts,
  groups,
  collapsedGroups,
  onToggleGroup,
  hoveredCell,
  selectedCell,
  onHoverCell,
  onHoverPositionChange,
  onSelectCell,
  onOpenCellMenu,
  showGrid,
  rowOffsets,
  totalContentHeight,
  cellLookup,
}: HeatmapGridProps) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === viewportEl) {
          setViewportWidth(entry.contentRect.width);
          setViewportHeight(entry.contentRect.height);
        }
      }
    });

    observer.observe(viewportEl);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((sl: number, st: number) => {
    setScrollLeft(sl);
    setScrollTop(st);
  }, []);

  const totalContentWidth = paperIds.length * (CELL_WIDTH + CELL_GAP);
  const cells = useMemo(() => Array.from(cellLookup.values()), [cellLookup]);
  const adjudicationByMappingId = useMemo(() => {
    const map = new Map<string, HeatmapCell['adjudicationStatus']>();
    for (const cell of cells) {
      map.set(cell.mappingId, cell.adjudicationStatus);
    }
    return map;
  }, [cells]);

  const showEmptyMatrixState = paperIds.length === 0 || concepts.length === 0;

  const resolveCellFromPointer = useCallback((
    clientX: number,
    clientY: number,
    element: HTMLDivElement,
  ): { row: number; col: number } | null => {
    if (paperIds.length === 0 || concepts.length === 0 || rowOffsets.length === 0) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const x = (clientX - rect.left) + scrollLeft;
    const y = (clientY - rect.top) + scrollTop;
    const stride = CELL_WIDTH + CELL_GAP;
    const col = Math.floor(x / stride);
    const colStart = col * stride;

    if (col < 0 || col >= paperIds.length || x - colStart >= CELL_WIDTH) {
      return null;
    }

    const row = binarySearchRow(rowOffsets, y);
    const rowTop = rowOffsets[row] ?? 0;
    if (row < 0 || row >= concepts.length || y < rowTop || y >= rowTop + CELL_HEIGHT) {
      return null;
    }

    return { row, col };
  }, [paperIds.length, concepts.length, rowOffsets, scrollLeft, scrollTop]);

  return (
    <div
      ref={rootRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px minmax(0, 1fr)`,
        gridTemplateRows: `${COLUMN_HEADER_HEIGHT}px minmax(0, 1fr)`,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: 'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-base) 100%)',
      }}
    >
      <CornerCell />

      <ColumnHeader
        paperIds={paperIds}
        paperLabels={paperLabels}
        scrollLeft={scrollLeft}
        hoveredCol={hoveredCell?.col ?? null}
        viewportWidth={viewportWidth}
      />

      <RowHeader
        concepts={concepts}
        groups={groups}
        collapsedGroups={collapsedGroups}
        onToggleGroup={onToggleGroup}
        scrollTop={scrollTop}
        hoveredRow={hoveredCell?.row ?? null}
        rowOffsets={rowOffsets}
      />

      <div
        ref={viewportRef}
        style={{
          position: 'relative',
          overflow: 'hidden',
          background:
            'linear-gradient(180deg, rgba(148, 163, 184, 0.06) 0%, rgba(148, 163, 184, 0.02) 100%)',
        }}
      >
        <MatrixViewport
          totalWidth={totalContentWidth}
          totalHeight={totalContentHeight}
          onScroll={handleScroll}
        >
          {showEmptyMatrixState ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                background: 'linear-gradient(180deg, rgba(0,0,0,0.01), rgba(0,0,0,0.03))',
              }}
            >
              {paperIds.length === 0 ? '数据库中暂无可显示的论文列' : '暂无可显示的概念行'}
            </div>
          ) : null}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              boxShadow: showEmptyMatrixState
                ? 'none'
                : 'inset 0 0 0 1px rgba(148, 163, 184, 0.16)',
            }}
          >
            <MatrixCanvas
              viewportWidth={viewportWidth}
              viewportHeight={viewportHeight}
              scrollLeft={scrollLeft}
              scrollTop={scrollTop}
              cells={cells}
              cellLookup={cellLookup}
              numPapers={paperIds.length}
              numConcepts={concepts.length}
              rowOffsets={rowOffsets}
              hoveredCell={hoveredCell}
              selectedCell={selectedCell}
              keyboardFocus={null}
              showGrid={showGrid}
              getAdjudicationStatus={(mappingId) => adjudicationByMappingId.get(mappingId) ?? 'pending'}
              pointerEvents="none"
              onMouseMove={() => {}}
              onMouseLeave={() => {}}
              onClick={() => {}}
              onDoubleClick={() => {}}
              onContextMenu={() => {}}
            />
            <div
              style={{ position: 'absolute', inset: 0 }}
              onMouseMove={(event) => {
                onHoverCell(resolveCellFromPointer(event.clientX, event.clientY, event.currentTarget));
                onHoverPositionChange({ x: event.clientX, y: event.clientY });
              }}
              onMouseLeave={() => {
                onHoverCell(null);
                onHoverPositionChange(null);
              }}
              onClick={(event) => {
                onSelectCell(resolveCellFromPointer(event.clientX, event.clientY, event.currentTarget));
                onOpenCellMenu(null, null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const resolvedCell = resolveCellFromPointer(event.clientX, event.clientY, event.currentTarget);
                if (!resolvedCell || !cellLookup.has(cellKey(resolvedCell.row, resolvedCell.col))) {
                  onOpenCellMenu(null, null);
                  return;
                }
                onOpenCellMenu(resolvedCell, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            />
          </div>
        </MatrixViewport>
      </div>
    </div>
  );
}
