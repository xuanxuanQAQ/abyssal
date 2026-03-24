/**
 * TagTree — 标签树组件（§2.3）
 *
 * 支持一级嵌套，Ctrl+Click 多标签交集过滤。
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { useTagList } from '../../../core/ipc/hooks/useTags';
import { TagTreeItem } from './TagTreeItem';
import { NewTagInput } from './NewTagInput';
import type { Tag } from '../../../../shared-types/models';

export function TagTree() {
  const { data: tags } = useTagList();
  const [showNewTag, setShowNewTag] = React.useState(false);

  if (!tags) return null;

  // 构建树结构：顶级标签按 paperCount 降序，子标签按 name 字母序
  const topLevel = tags
    .filter((t) => t.parentId === null)
    .sort((a, b) => b.paperCount - a.paperCount);

  const childrenOf = (parentId: string): Tag[] =>
    tags
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div role="tree" aria-label="标签">
      {topLevel.map((tag) => (
        <TagTreeItem key={tag.id} tag={tag} children={childrenOf(tag.id)} />
      ))}

      {showNewTag ? (
        <NewTagInput onDone={() => setShowNewTag(false)} />
      ) : (
        <button
          onClick={() => setShowNewTag(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            padding: '5px 12px 5px 20px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <Plus size={12} />
          新建标签
        </button>
      )}
    </div>
  );
}
