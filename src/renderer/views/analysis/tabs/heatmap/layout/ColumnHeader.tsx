/**
 * ColumnHeader — 【Δ-2】Column headers with rotated -45° text.
 *
 * Container: overflow: hidden, position: sticky; top: 0; z-index: 2.
 * Inner content translates with CSS transform: translateX(-scrollLeft).
 * Virtual rendering for > 500 papers.
 * Each label: width=CELL_WIDTH, height=COLUMN_HEADER_HEIGHT, text rotated -45deg
 * from bottom-left origin, font-size 11px, max text width ~170px.
 */

import React, { useMemo } from 'react';
import { CELL_WIDTH, CELL_GAP, COLUMN_HEADER_HEIGHT } from './layoutConstants';

interface ColumnHeaderProps {
  paperIds: string[];
  paperLabels: string[];
  scrollLeft: number;
  hoveredCol: number | null;
  viewportWidth: number;
}

const VIRTUAL_THRESHOLD = 500;
const LABEL_MAX_WIDTH = 170;
const stride = CELL_WIDTH + CELL_GAP;

export const ColumnHeader = React.memo(function ColumnHeader({
  paperIds,
  paperLabels,
  scrollLeft,
  hoveredCol,
  viewportWidth,
}: ColumnHeaderProps) {
  const useVirtualization = paperIds.length > VIRTUAL_THRESHOLD;

  const visibleRange = useMemo(() => {
    if (!useVirtualization) {
      return { start: 0, end: paperIds.length - 1 };
    }
    // overscan by 2 columns on each side
    const start = Math.max(0, Math.floor(scrollLeft / stride) - 2);
    const end = Math.min(
      paperIds.length - 1,
      Math.ceil((scrollLeft + viewportWidth) / stride) + 2,
    );
    return { start, end };
  }, [useVirtualization, scrollLeft, viewportWidth, paperIds.length]);

  const totalWidth = paperIds.length * stride;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        overflow: 'hidden',
        height: COLUMN_HEADER_HEIGHT,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: totalWidth,
          height: COLUMN_HEADER_HEIGHT,
          transform: `translateX(${-scrollLeft}px)`,
          willChange: 'transform',
        }}
      >
        {Array.from(
          { length: visibleRange.end - visibleRange.start + 1 },
          (_, i) => {
            const colIdx = visibleRange.start + i;
            const label = paperLabels[colIdx] ?? '';
            const isHovered = hoveredCol === colIdx;

            return (
              <div
                key={paperIds[colIdx]}
                style={{
                  position: 'absolute',
                  left: colIdx * stride,
                  bottom: 0,
                  width: CELL_WIDTH,
                  height: COLUMN_HEADER_HEIGHT,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    left: 2,
                    transformOrigin: 'bottom left',
                    transform: 'rotate(-45deg)',
                    fontSize: 11,
                    lineHeight: '14px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: LABEL_MAX_WIDTH,
                    color: isHovered
                      ? 'var(--accent-color)'
                      : 'var(--text-secondary)',
                    fontWeight: isHovered ? 600 : 400,
                    userSelect: 'none',
                  }}
                  title={label}
                >
                  {label}
                </span>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
});
