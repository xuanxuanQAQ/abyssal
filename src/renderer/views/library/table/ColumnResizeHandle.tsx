/**
 * ColumnResizeHandle — 列宽拖拽手柄（§3.2）
 *
 * 4px 透明 hit area，悬停时显示竖线。
 */

import React from 'react';
import type { Header, Table as TanStackTable } from '@tanstack/react-table';
import type { Paper } from '../../../../shared-types/models';

interface ColumnResizeHandleProps {
  header: Header<Paper, unknown>;
  table: TanStackTable<Paper>;
}

export function ColumnResizeHandle({ header, table }: ColumnResizeHandleProps) {
  return (
    <div
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        height: '100%',
        width: 4,
        cursor: 'col-resize',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: 1,
          top: '20%',
          height: '60%',
          width: 1,
          backgroundColor: header.column.getIsResizing()
            ? 'var(--accent-color)'
            : 'transparent',
          transition: 'background-color 150ms',
        }}
        className="resize-indicator"
      />
    </div>
  );
}
