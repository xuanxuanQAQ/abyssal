/**
 * NotesView  笔记系统主视图
 *
 * 碎片笔记（流式快速记录）与研究笔记（结构化长篇）。
 * 左侧筛选栏收窄范围，右侧按 tab 切换内容。
 * 研究笔记点击后全幅切换为编辑器，返回回到列表。
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { StickyNote, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MemoStream } from './memo/MemoStream';
import { NoteCardGrid } from './note/NoteCardGrid';
import { NoteEditor } from './note/NoteEditor';
import { NotesFilterSidebar } from './NotesFilterSidebar';
import type { MemoFilter, NoteFilter } from '../../../shared-types/models';
import { useConceptList } from '../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../core/ipc/hooks/usePapers';
import { useMemoList } from '../../core/ipc/hooks/useMemos';
import { useNoteList } from '../../core/ipc/hooks/useNotes';
import { useAppStore } from '../../core/store';

export function NotesView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'memos' | 'notes'>('memos');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoFilter>({});
  const selectedNoteId = useAppStore((s) => s.selectedNoteId);
  const selectedMemoId = useAppStore((s) => s.selectedMemoId);
  const selectNote = useAppStore((s) => s.selectNote);
  const openMemoQuickInput = useAppStore((s) => s.openMemoQuickInput);

  const { data: concepts } = useConceptList();
  const conceptList = useMemo(
    () => (concepts ?? []).map((c) => {
      const cr = c as unknown as Record<string, unknown>;
      return { id: (cr['id'] as string) ?? '', nameEn: (cr['nameEn'] ?? cr['name_en'] ?? cr['id']) as string };
    }),
    [concepts],
  );

  const { data: papers } = usePaperList();
  const paperList = useMemo(
    () => (papers ?? []).map((p) => {
      const pr = p as unknown as Record<string, unknown>;
      return { id: (pr['id'] as string) ?? '', title: ((pr['title'] as string) ?? '').slice(0, 80) || ((pr['id'] as string) ?? '') };
    }),
    [papers],
  );

  const { data: memoData } = useMemoList({});
  const noteFilter = useMemo<NoteFilter>(() => {
    const nf: NoteFilter = {};
    if (filter.conceptIds?.length) nf.conceptIds = filter.conceptIds;
    if (filter.paperIds?.length) nf.paperIds = filter.paperIds;
    if (filter.tags?.length) nf.tags = filter.tags;
    if (filter.searchText?.trim()) nf.searchText = filter.searchText.trim();
    return nf;
  }, [filter]);
  const { data: noteData } = useNoteList(noteFilter);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const page of memoData?.pages ?? []) {
      for (const memo of (page as unknown as Array<Record<string, unknown>>)) {
        ((memo['tags'] as string[]) ?? []).forEach((tag) => tagSet.add(tag));
      }
    }
    return Array.from(tagSet).sort();
  }, [memoData]);

  const loadedMemoCount = useMemo(
    () => memoData?.pages.reduce((sum, page) => sum + page.length, 0) ?? 0,
    [memoData],
  );

  useEffect(() => {
    if (selectedNoteId) {
      setActiveTab('notes');
      setEditingNoteId(selectedNoteId);
      return;
    }
    if (selectedMemoId) {
      setActiveTab('memos');
      setEditingNoteId(null);
    }
  }, [selectedNoteId, selectedMemoId]);

  const handleOpenNote = useCallback((noteId: string) => {
    selectNote(noteId);
    setEditingNoteId(noteId);
  }, [selectNote]);

  const handleBackFromNote = useCallback(() => {
    setEditingNoteId(null);
    selectNote(null);
  }, [selectNote]);

  const handleQuickMemo = useCallback(() => {
    openMemoQuickInput({ sourceView: 'notes' });
  }, [openMemoQuickInput]);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: 'var(--bg-base)' }}>
      <NotesFilterSidebar
        filter={filter}
        onFilterChange={setFilter}
        concepts={conceptList}
        papers={paperList}
        allTags={allTags}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Tabs.Root
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as 'memos' | 'notes');
            setEditingNoteId(null);
            if (v !== 'notes') selectNote(null);
          }}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          {/* Tab bar */}
          <div style={topBarStyle}>
            <Tabs.List style={tabListStyle}>
              <Tabs.Trigger value="memos" style={tabStyle(activeTab === 'memos')}>
                <StickyNote size={14} />
                {t('notes.tabs.memos')}
                <span style={countStyle(activeTab === 'memos')}>{loadedMemoCount}</span>
              </Tabs.Trigger>
              <Tabs.Trigger value="notes" style={tabStyle(activeTab === 'notes')}>
                <FileText size={14} />
                {t('notes.tabs.researchNotes')}
                <span style={countStyle(activeTab === 'notes')}>{noteData?.length ?? 0}</span>
              </Tabs.Trigger>
            </Tabs.List>

            {activeTab === 'memos' && (
              <button type="button" onClick={handleQuickMemo} style={actionBtnStyle}>
                <StickyNote size={13} />
                {t('notes.workspace.quickMemo', '快速记录')}
              </button>
            )}
          </div>

          {/* Content */}
          <Tabs.Content value="memos" style={contentStyle}>
            <MemoStream filter={filter} />
          </Tabs.Content>

          <Tabs.Content value="notes" style={contentStyle}>
            {editingNoteId ? (
              <NoteEditor noteId={editingNoteId} onBack={handleBackFromNote} />
            ) : (
              <NoteCardGrid onOpenNote={handleOpenNote} filter={filter} />
            )}
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

//  Styles 

const topBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  flexShrink: 0,
};

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    border: 'none',
    borderRadius: 6,
    background: active ? 'color-mix(in srgb, var(--accent-color) 10%, transparent)' : 'transparent',
    color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
  };
}

function countStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    minWidth: 18,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    padding: '0 5px',
    background: active ? 'color-mix(in srgb, var(--accent-color) 14%, transparent)' : 'var(--bg-surface-high, rgba(0,0,0,0.04))',
    color: active ? 'var(--accent-color)' : 'var(--text-muted)',
  };
}

const actionBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  minHeight: 0,
};