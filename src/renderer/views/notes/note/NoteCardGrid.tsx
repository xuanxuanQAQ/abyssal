/**
 * NoteCardGrid  研究笔记卡片列表
 *
 * 全幅列表，点击卡片后由 NotesView 切换到编辑器。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { NoteCard } from './NoteCard';
import { CreateNoteDialog } from './CreateNoteDialog';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';
import type { MemoFilter } from '../../../../shared-types/models';
import { useEntityDisplayNameCache } from '../shared/entityDisplayNameCache';

interface NoteCardGridProps {
  onOpenNote: (noteId: string) => void;
  filter?: MemoFilter;
}

export function NoteCardGrid({ onOpenNote, filter }: NoteCardGridProps) {
  const { t } = useTranslation();
  const entityNameCache = useEntityDisplayNameCache();
  const noteFilter = filter ? (() => {
    const nf: import('../../../../shared-types/models').NoteFilter = {};
    if (filter.conceptIds) nf.conceptIds = filter.conceptIds;
    if (filter.paperIds) nf.paperIds = filter.paperIds;
    if (filter.tags) nf.tags = filter.tags;
    if (filter.searchText) nf.searchText = filter.searchText;
    return nf;
  })() : undefined;
  const { data: notes } = useNoteList(noteFilter);
  const [showCreate, setShowCreate] = useState(false);

  const filteredNotes = notes ?? [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={headerStyle}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filteredNotes.length > 0
            ? t('notes.note.listSummary', { count: filteredNotes.length, defaultValue: `${filteredNotes.length} 条研究笔记` })
            : t('notes.tabs.researchNotes')}
        </span>
        <button onClick={() => setShowCreate(true)} style={createBtnStyle}>
          <Plus size={13} /> {t('notes.note.newNote')}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => onOpenNote(note.id)}
              entityNameCache={entityNameCache}
            />
          ))}
        </div>

        {filteredNotes.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
            {notes && notes.length > 0
              ? t('notes.note.noMatchingNotes')
              : t('notes.note.emptyState')}
          </div>
        )}
      </div>

      <CreateNoteDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onOpenNote} />
    </div>
  );
}

//  Styles 

const headerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
};

const createBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  border: 'none',
  borderRadius: 6,
  backgroundColor: 'var(--accent-color)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};