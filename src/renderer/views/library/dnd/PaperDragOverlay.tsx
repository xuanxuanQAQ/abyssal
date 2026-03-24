/**
 * PaperDragOverlay — 论文拖拽预览胶囊（§12.1）
 *
 * DragOverlay Portal：紧凑论文胶囊。
 * 多选时显示 "+ N 篇论文"。
 */

import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { FileText } from 'lucide-react';
import type { PaperDragData } from '../hooks/usePaperDrag';

interface PaperDragOverlayProps {
  activeData: PaperDragData | null;
  selectedCount: number;
}

export function PaperDragOverlay({ activeData, selectedCount }: PaperDragOverlayProps) {
  if (!activeData) return null;

  return (
    <DragOverlay>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '8px 12px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--accent-color)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: 280,
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={14} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
            {activeData.firstAuthor} {activeData.year}
          </span>
        </div>
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activeData.title}
        </span>
        {selectedCount > 1 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--accent-color)' }}>
            + {selectedCount - 1} 篇论文
          </span>
        )}
      </div>
    </DragOverlay>
  );
}
