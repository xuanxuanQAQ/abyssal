/**
 * MemoCountCell — 论文行的 memo 计数小图标（§8.2）
 */

import React from 'react';
import { StickyNote } from 'lucide-react';

interface MemoCountCellProps {
  count: number;
}

export function MemoCountCell({ count }: MemoCountCellProps) {
  if (count === 0) return null;

  return (
    <span
      title={`${count} 条碎片笔记`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
      }}
    >
      <StickyNote size={12} />
      {count}
    </span>
  );
}
