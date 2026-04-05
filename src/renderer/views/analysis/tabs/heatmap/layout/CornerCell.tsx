/**
 * CornerCell — Frozen top-left corner of the heatmap grid.
 *
 * position: sticky; top: 0; left: 0; z-index: 3.
 * Displays the "概念 \ 论文" label.
 */

import React from 'react';
import { ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT } from './layoutConstants';

interface CornerCellProps {
  width?: number;
  height?: number;
}

export function CornerCell({ width, height }: CornerCellProps) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        zIndex: 3,
        width: width ?? ROW_HEADER_WIDTH,
        height: height ?? COLUMN_HEADER_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 12px',
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          fontWeight: 600,
          letterSpacing: 0.3,
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {'概念 \\ 论文'}
      </span>
    </div>
  );
}
