/**
 * CornerCell — Frozen top-left corner of the heatmap grid.
 *
 * position: sticky; top: 0; left: 0; z-index: 3.
 * Displays the "概念 \ 论文" label.
 */

import React from 'react';
import { ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT } from './layoutConstants';

export function CornerCell() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        left: 0,
        zIndex: 3,
        width: ROW_HEADER_WIDTH,
        height: COLUMN_HEADER_HEIGHT,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
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
          userSelect: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {'概念 \\ 论文'}
      </span>
    </div>
  );
}
