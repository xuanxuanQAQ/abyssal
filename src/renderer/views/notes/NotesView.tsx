/**
 * NotesView — 双层笔记系统视图（v2.0）
 *
 * 左 Tab: Memos（碎片笔记流）
 * 右 Tab: Research Notes（结构化笔记网格/编辑器）
 */

import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { StickyNote, FileText } from 'lucide-react';
import { MemoStream } from './memo/MemoStream';
import { NoteCardGrid } from './note/NoteCardGrid';
import { NoteEditor } from './note/NoteEditor';

export function NotesView() {
  const [activeTab, setActiveTab] = useState<'memos' | 'notes'>('memos');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <Tabs.Root value={activeTab} onValueChange={(v) => { setActiveTab(v as 'memos' | 'notes'); setEditingNoteId(null); }}>
        <Tabs.List style={{
          display: 'flex', alignItems: 'stretch', height: 36, borderBottom: '1px solid var(--border-color)', flexShrink: 0,
        }}>
          <Tabs.Trigger value="memos" style={tabTriggerStyle(activeTab === 'memos')}>
            <StickyNote size={14} style={{ marginRight: 4 }} /> Memos
          </Tabs.Trigger>
          <Tabs.Trigger value="notes" style={tabTriggerStyle(activeTab === 'notes')}>
            <FileText size={14} style={{ marginRight: 4 }} /> Research Notes
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="memos" style={{ flex: 1, overflow: 'hidden' }}>
          <MemoStream />
        </Tabs.Content>

        <Tabs.Content value="notes" style={{ flex: 1, overflow: 'hidden' }}>
          {editingNoteId ? (
            <NoteEditor noteId={editingNoteId} onBack={() => setEditingNoteId(null)} />
          ) : (
            <NoteCardGrid onOpenNote={setEditingNoteId} />
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function tabTriggerStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--accent-color)' : '2px solid transparent',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 13, lineHeight: '20px',
    display: 'flex', alignItems: 'center',
  };
}
