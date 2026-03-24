/**
 * HeatmapGrid — CSS Grid 4-quadrant container
 *
 * Exports layout constants used by canvas, data, and header components.
 * Grid template: ROW_HEADER_WIDTH | 1fr  x  COLUMN_HEADER_HEIGHT | 1fr
 * Children: CornerCell, ColumnHeader, RowHeader, MatrixViewport.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { CornerCell } from './CornerCell';
import { ColumnHeader } from './ColumnHeader';
import { RowHeader } from './RowHeader';
import { MatrixViewport } from './MatrixViewport';
import type { HeatmapCell } from '../../../../../../shared-types/models';
import {
  CELL_WIDTH,
  CELL_GAP,
  ROW_HEADER_WIDTH,
  COLUMN_HEADER_HEIGHT,
} from './layoutConstants';

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
  onSelectCell: (cell: { row: number; col: number } | null) => void;
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
  onHoverCell,
  rowOffsets,
  totalContentHeight,
}: HeatmapGridProps) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((sl: number, st: number) => {
    setScrollLeft(sl);
    setScrollTop(st);
  }, []);

  const totalContentWidth = paperIds.length * (CELL_WIDTH + CELL_GAP);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${ROW_HEADER_WIDTH}px 1fr`,
        gridTemplateRows: `${COLUMN_HEADER_HEIGHT}px 1fr`,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Top-left corner */}
      <CornerCell />

      {/* Column headers (top-right) */}
      <ColumnHeader
        paperIds={paperIds}
        paperLabels={paperLabels}
        scrollLeft={scrollLeft}
        hoveredCol={hoveredCell?.col ?? null}
        viewportWidth={viewportWidth}
      />

      {/* Row headers (bottom-left) */}
      <RowHeader
        concepts={concepts}
        groups={groups}
        collapsedGroups={collapsedGroups}
        onToggleGroup={onToggleGroup}
        scrollTop={scrollTop}
        hoveredRow={hoveredCell?.row ?? null}
        rowOffsets={rowOffsets}
      />

      {/* Matrix viewport (bottom-right) */}
      <div ref={viewportRef} style={{ position: 'relative', overflow: 'hidden' }}>
        <MatrixViewport
          totalWidth={totalContentWidth}
          totalHeight={totalContentHeight}
          onScroll={handleScroll}
        >
          {/* MatrixCanvas will be placed here by HeatmapTab */}
          <div
            style={{ position: 'relative', width: '100%', height: '100%' }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left + scrollLeft;
              const y = e.clientY - rect.top + scrollTop;
              const col = Math.floor(x / (CELL_WIDTH + CELL_GAP));
              // Use rowOffsets for row lookup via binary search
              let row = 0;
              for (let i = rowOffsets.length - 1; i >= 0; i--) {
                if (rowOffsets[i]! <= y) {
                  row = i;
                  break;
                }
              }
              if (col >= 0 && col < paperIds.length && row >= 0 && row < concepts.length) {
                onHoverCell({ row, col });
              } else {
                onHoverCell(null);
              }
            }}
            onMouseLeave={() => onHoverCell(null)}
          />
        </MatrixViewport>
      </div>
    </div>
  );
}
