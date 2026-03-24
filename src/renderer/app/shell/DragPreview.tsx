/**
 * DragPreview — 拖拽预览组件（§9.2）
 *
 * DragOverlay 内部渲染，按拖拽场景显示不同预览内容。
 * TODO: 具体拖拽场景在 Sub-Doc 4~8 中实现。
 */

import React from 'react';

export type DragItemType =
  | 'paper'
  | 'rag-passage'
  | 'synthesis-fragment'
  | 'outline-node';

export interface DragItem {
  type: DragItemType;
  id: string;
  title: string;
}

interface DragPreviewProps {
  item: DragItem;
}

export function DragPreview({ item }: DragPreviewProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--accent-color)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        maxWidth: 240,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        fontSize: 'var(--text-sm)',
        color: 'var(--text-primary)',
        cursor: 'grabbing',
      }}
    >
      {item.title}
    </div>
  );
}
