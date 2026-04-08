/**
 * RelatedNotes — 关联笔记折叠区（§8.1, §8.5）
 *
 * 在 Reader/Writing ContextPanel 中显示关联的 memos 和 notes。
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, StickyNote, FileText } from 'lucide-react';
import { useMemoList } from '../../../core/ipc/hooks/useMemos';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';
import { useAppStore } from '../../../core/store';
import { cancelPendingContextReveal, previewContextSource } from '../engine/revealContextSource';
import type { MemoFilter, NoteFilter } from '../../../../shared-types/models';

interface RelatedNotesProps {
  paperIds?: string[];
  conceptIds?: string[];
}

// ── Static styles ──

const containerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-subtle)',
  padding: '8px 0',
};

const toggleButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  width: '100%',
  padding: '4px 12px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontSize: 12,
  fontWeight: 600,
};

const listContainerStyle: React.CSSProperties = {
  padding: '4px 12px',
};

const memoRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  padding: '4px 0',
  borderBottom: '1px solid var(--border-subtle)',
};

const memoIconStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: 2,
  color: 'var(--text-muted)',
};

const memoTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const noteRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 0',
  borderBottom: '1px solid var(--border-subtle)',
};

const noteIconStyle: React.CSSProperties = {
  flexShrink: 0,
  color: 'var(--text-muted)',
};

const noteTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-primary)',
  fontWeight: 500,
};

export const RelatedNotes = React.memo(function RelatedNotes({ paperIds, conceptIds }: RelatedNotesProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const navigateTo = useAppStore((s) => s.navigateTo);

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
    <div style={containerStyle}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={toggleButtonStyle}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('context.relatedNotes.title', { count: totalCount })}
      </button>

      {expanded && (
        <div style={listContainerStyle}>
          {memos.slice(0, 5).map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => previewContextSource({ type: 'memo', memoId: m.id })}
              onMouseLeave={cancelPendingContextReveal}
              onClick={() => navigateTo({ type: 'memo', memoId: m.id })}
              className="context-preview-trigger"
              style={{ ...memoRowStyle, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 6, transition: 'background-color 140ms ease, border-color 140ms ease' }}
            >
              <StickyNote size={12} style={memoIconStyle} />
              <span style={memoTextStyle}>
                {m.text}
              </span>
            </button>
          ))}
          {notes?.slice(0, 3).map((n) => (
            <button
              key={n.id}
              type="button"
              onMouseEnter={() => previewContextSource({ type: 'note', noteId: n.id })}
              onMouseLeave={cancelPendingContextReveal}
              onClick={() => navigateTo({ type: 'note', noteId: n.id })}
              className="context-preview-trigger"
              style={{ ...noteRowStyle, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 6, transition: 'background-color 140ms ease, border-color 140ms ease' }}
            >
              <FileText size={12} style={noteIconStyle} />
              <span style={noteTitleStyle}>{n.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
