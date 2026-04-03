/**
 * NotesView — dual-layer notes system (v2.0)
 *
 * Left: NotesFilterSidebar (200px, multi-dimensional filter)
 * Right: Tab switching between MemoStream and NoteCardGrid/Editor
 *
 * See spec: section 6.1
 */

import React, { useState, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { StickyNote, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MemoStream } from './memo/MemoStream';
import { NoteCardGrid } from './note/NoteCardGrid';
import { NoteEditor } from './note/NoteEditor';
import { NotesFilterSidebar } from './NotesFilterSidebar';
import type { MemoFilter } from '../../../shared-types/models';
import { useConceptList } from '../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../core/ipc/hooks/usePapers';
import { useMemoList } from '../../core/ipc/hooks/useMemos';

export function NotesView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'memos' | 'notes'>('memos');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoFilter>({});

  // Load concepts for filter sidebar
  const { data: concepts } = useConceptList();
  const conceptList = useMemo(
    () => (concepts ?? []).map((c) => {
      const cr = c as unknown as Record<string, unknown>;
      return {
        id: (cr['id'] as string) ?? '',
        nameEn: (cr['nameEn'] ?? cr['name_en'] ?? cr['id']) as string,
      };
    }),
    [concepts],
  );

  // Load papers for filter sidebar
  const { data: papers } = usePaperList();
  const paperList = useMemo(
    () => (papers ?? []).map((p) => {
      const pr = p as unknown as Record<string, unknown>;
      return {
        id: (pr['id'] as string) ?? '',
        title: ((pr['title'] as string) ?? '').slice(0, 80) || ((pr['id'] as string) ?? ''),
      };
    }),
    [papers],
  );

  // Aggregate tags from memo data for tag cloud
  const { data: memoData } = useMemoList({});
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const page of memoData?.pages ?? []) {
      for (const memo of (page as unknown as Array<Record<string, unknown>>)) {
        const tags = (memo['tags'] as string[]) ?? [];
        tags.forEach((t) => tagSet.add(t));
      }
    }
    return Array.from(tagSet).sort();
  }, [memoData]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {/* Filter Sidebar */}
      <NotesFilterSidebar
        filter={filter}
        onFilterChange={setFilter}
        concepts={conceptList}
        papers={paperList}
        allTags={allTags}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => { setActiveTab(v as 'memos' | 'notes'); setEditingNoteId(null); }}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <Tabs.List style={{
            display: 'flex', alignItems: 'stretch', height: 36,
            borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
          }}>
            <Tabs.Trigger value="memos" style={tabTriggerStyle(activeTab === 'memos')}>
              <StickyNote size={14} style={{ marginRight: 4 }} /> {t('notes.tabs.memos')}
            </Tabs.Trigger>
            <Tabs.Trigger value="notes" style={tabTriggerStyle(activeTab === 'notes')}>
              <FileText size={14} style={{ marginRight: 4 }} /> {t('notes.tabs.researchNotes')}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="memos" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <MemoStream filter={filter} />
          </Tabs.Content>

          <Tabs.Content value="notes" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {editingNoteId ? (
              <NoteEditor noteId={editingNoteId} onBack={() => setEditingNoteId(null)} />
            ) : (
              <NoteCardGrid onOpenNote={setEditingNoteId} filter={filter} />
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>
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
