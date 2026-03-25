/**
 * RelatedNotes — 关联笔记折叠区（§8.1, §8.5）
 *
 * 在 Reader/Writing ContextPanel 中显示关联的 memos 和 notes。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, StickyNote, FileText } from 'lucide-react';
import { useMemoList } from '../../../core/ipc/hooks/useMemos';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';
import type { Memo, NoteMeta, MemoFilter, NoteFilter } from '../../../../shared-types/models';

interface RelatedNotesProps {
  paperIds?: string[];
  conceptIds?: string[];
}

export function RelatedNotes({ paperIds, conceptIds }: RelatedNotesProps) {
  const [expanded, setExpanded] = useState(false);

  const memoFilter: MemoFilter = { limit: 5 };
  if (paperIds !== undefined) memoFilter.paperIds = paperIds;
  if (conceptIds !== undefined) memoFilter.conceptIds = conceptIds;

  const noteFilter: NoteFilter = {};
  if (paperIds !== undefined) noteFilter.paperIds = paperIds;
  if (conceptIds !== undefined) noteFilter.conceptIds = conceptIds;

  const { data: memoData } = useMemoList(memoFilter);
  const { data: notes } = useNoteList(noteFilter);

  const memos = memoData?.pages.flat() ?? [];
  const totalCount = memos.length + (notes?.length ?? 0);

  if (totalCount === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 0' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, width: '100%',
          padding: '4px 12px', background: 'none', border: 'none',
          cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Related Notes ({totalCount})
      </button>

      {expanded && (
        <div style={{ padding: '4px 12px' }}>
          {memos.slice(0, 5).map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <StickyNote size={12} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {m.text}
              </span>
            </div>
          ))}
          {notes?.slice(0, 3).map((n) => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <FileText size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{n.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
