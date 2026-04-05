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
  effectiveHeight?: number;
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
  effectiveHeight,
}: ColumnHeaderProps) {
  const headerHeight = effectiveHeight ?? COLUMN_HEADER_HEIGHT;
  const hasPapers = paperIds.length > 0;
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
        height: headerHeight,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {!hasPapers ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: 'var(--text-muted)',
            fontSize: 12,
            letterSpacing: 0.2,
          }}
        >
          暂无论文列
        </div>
      ) : null}
      <div
        style={{
          position: 'relative',
          width: totalWidth,
          height: headerHeight,
          transform: `translateX(${-scrollLeft}px)`,
          willChange: 'transform',
          opacity: hasPapers ? 1 : 0,
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
                  height: headerHeight,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 0,
                    width: 1,
                    height: 10,
                    transform: 'translateX(-0.5px)',
                    backgroundColor: isHovered
                      ? 'var(--accent-color)'
                      : 'var(--border-subtle)',
                    opacity: 0.9,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    left: '50%',
                    transformOrigin: 'bottom center',
                    transform: 'translateX(-50%) rotate(-52deg)',
                    fontSize: 11,
                    lineHeight: '14px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: LABEL_MAX_WIDTH,
                    color: isHovered
                      ? 'var(--accent-color)'
                      : 'var(--text-secondary)',
                    fontWeight: isHovered ? 600 : 500,
                    userSelect: 'none',
                    textShadow: '0 1px 0 rgba(255,255,255,0.5)',
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
