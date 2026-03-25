/**
 * AnnotationAndMemoPanel — Reader 右侧面板（§8.1）
 * 上下两个 Radix Tabs: Annotations + Memos
 */

import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AnnotationList } from './AnnotationList';
import { MemoQuickCreate } from '../../notes/memo/MemoQuickCreate';
import { useMemoList } from '../../../core/ipc/hooks/useMemos';
import { MemoCard } from '../../notes/memo/MemoCard';

interface AnnotationAndMemoPanelProps {
  paperId: string;
}

export function AnnotationAndMemoPanel({ paperId }: AnnotationAndMemoPanelProps) {
  const [tab, setTab] = useState<'annotations' | 'memos'>('annotations');
  const { data } = useMemoList({ paperIds: [paperId] });
  const memos = data?.pages.flat() ?? [];

  return (
    <Tabs.Root value={tab} onValueChange={(v) => setTab(v as 'annotations' | 'memos')} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Tabs.List style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <Tabs.Trigger value="annotations" style={triggerStyle(tab === 'annotations')}>
          Annotations
        </Tabs.Trigger>
        <Tabs.Trigger value="memos" style={triggerStyle(tab === 'memos')}>
          Memos ({memos.length})
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="annotations" style={{ flex: 1, overflow: 'auto' }}>
        <AnnotationList paperId={paperId} onScrollToAnnotation={() => {}} />
      </Tabs.Content>

      <Tabs.Content value="memos" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px 0' }}>
          {memos.map((m) => <MemoCard key={m.id} memo={m} />)}
          {memos.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              暂无关联笔记
            </div>
          )}
        </div>
        <MemoQuickCreate paperIds={[paperId]} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function triggerStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '6px 8px', background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--accent-color)' : '2px solid transparent',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400,
  };
}
