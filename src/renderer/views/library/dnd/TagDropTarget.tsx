/**
 * TagDropTarget — 标签接收拖入的论文（§12.2）
 *
 * 包装 useDroppable，论文拖入标签时高亮。
 * 实际的 drop 处理由父级 DndContext 的 onDragEnd 处理。
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface TagDropTargetProps {
  tagId: string;
  children: React.ReactNode;
}

export function TagDropTarget({ tagId, children }: TagDropTargetProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `sidebar-tag:${tagId}`,
    data: { type: 'tag', tagId },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        backgroundColor: isOver ? 'var(--accent-color-10)' : 'transparent',
        transition: 'background-color 150ms',
      }}
    >
      {children}
    </div>
  );
}
