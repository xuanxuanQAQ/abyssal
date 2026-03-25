/**
 * NoteContextPane — Graph 视图中点击 memo/note 节点时的面板（§7.3）
 */

import React from 'react';
import { useMemo as useReactMemo } from 'react';
import { StickyNote, FileText } from 'lucide-react';

interface NoteContextPaneProps {
  nodeId: string;
  nodeType: 'memo' | 'note';
}

export function NoteContextPane({ nodeId, nodeType }: NoteContextPaneProps) {
  // TODO: fetch memo/note data by nodeId
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        {nodeType === 'memo' ? <StickyNote size={16} /> : <FileText size={16} />}
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {nodeType === 'memo' ? '碎片笔记' : '结构化笔记'}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        TODO: 显示笔记全文和关联实体列表
      </div>
    </div>
  );
}
