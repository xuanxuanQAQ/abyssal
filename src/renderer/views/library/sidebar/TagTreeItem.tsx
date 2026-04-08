/**
 * TagTreeItem — 单个标签项（§2.3）
 *
 * 可展开子标签、可接收论文拖入添加标签、右键上下文菜单。
 * Ctrl+Click 追加到多标签交集过滤。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Tag as TagIcon } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useAppStore } from '../../../core/store';
import type { Tag } from '../../../../shared-types/models';

interface TagTreeItemProps {
  tag: Tag;
  children: Tag[];
}

export function TagTreeItem({ tag, children }: TagTreeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = children.length > 0;

  const activeGroupType = useAppStore((s) => s.activeGroupType);
  const activeTagIds = useAppStore((s) => s.activeTagIds);
  const activeGroupId = useAppStore((s) => s.activeGroupId);
  const setActiveGroup = useAppStore((s) => s.setActiveGroup);
  const toggleActiveTagId = useAppStore((s) => s.toggleActiveTagId);
  const deselectAllPapers = useAppStore((s) => s.deselectAllPapers);

  const isActive =
    (activeGroupType === 'tag' && activeGroupId === tag.id) ||
    activeTagIds.includes(tag.id);

  const { setNodeRef, isOver } = useDroppable({
    id: `sidebar-tag:${tag.id}`,
    data: { type: 'tag', tagId: tag.id },
  });

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click：追加到多标签交集过滤
      toggleActiveTagId(tag.id);
    } else {
      setActiveGroup(tag.id, 'tag');
      deselectAllPapers();
    }
  };

  return (
    <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        ref={setNodeRef}
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 12px 4px 20px',
          cursor: 'pointer',
          backgroundColor: isOver
            ? 'var(--accent-color-10)'
            : isActive
              ? 'var(--accent-color-10)'
              : 'transparent',
          color: isActive ? 'var(--accent-color)' : 'var(--text-primary)',
          fontSize: 'var(--text-sm)',
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'inherit',
              display: 'flex',
            }}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span style={{ width: 10 }} />
        )}
        <TagIcon
          size={12}
          style={{ color: tag.color ?? 'var(--text-muted)' }}
        />
        <span style={{ flex: 1 }}>{tag.name}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          {tag.paperCount}
        </span>
      </div>

      {hasChildren && expanded && (
        <div style={{ paddingLeft: 12 }}>
          {children.map((child) => (
            <TagTreeItem key={child.id} tag={child} children={[]} />
          ))}
        </div>
      )}
    </div>
  );
}
