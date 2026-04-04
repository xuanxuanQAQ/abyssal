/**
 * NoteCardGrid — responsive card grid for structured notes.
 *
 * Accepts filter from NotesFilterSidebar.
 * Cards show title, excerpt, entity tags, last modified date.
 *
 * See spec: section 6.4
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
  // Extract NoteFilter-compatible fields from MemoFilter
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
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px',
            border: 'none', borderRadius: 'var(--radius-sm, 4px)',
            backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 12, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> {t('notes.note.newNote')}
        </button>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {filteredNotes.map((note) => (
          <NoteCard key={note.id} note={note} onClick={() => onOpenNote(note.id)} entityNameCache={entityNameCache} />
        ))}
      </div>

      {filteredNotes.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {notes && notes.length > 0
            ? t('notes.note.noMatchingNotes')
            : t('notes.note.emptyState')}
        </div>
      )}

      <CreateNoteDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onOpenNote} />
    </div>
  );
}
