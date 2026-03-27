/**
 * NoteCardGrid — responsive card grid for structured notes.
 *
 * Accepts filter from NotesFilterSidebar.
 * Cards show title, excerpt, entity tags, last modified date.
 *
 * See spec: section 6.4
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { NoteCard } from './NoteCard';
import { CreateNoteDialog } from './CreateNoteDialog';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';
import type { MemoFilter } from '../../../../shared-types/models';

interface NoteCardGridProps {
  onOpenNote: (noteId: string) => void;
  filter?: MemoFilter;
}

export function NoteCardGrid({ onOpenNote, filter }: NoteCardGridProps) {
  // TODO: pass filter to useNoteList when backend supports note filtering
  const { data: notes } = useNoteList();
  const [showCreate, setShowCreate] = React.useState(false);

  // Client-side filtering as a fallback until backend supports note filters
  const filteredNotes = React.useMemo(() => {
    if (!notes) return [];
    let result = [...notes];

    const searchQuery = (filter as Record<string, unknown> | undefined)?.['searchQuery'] as string | undefined;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => {
        const title = ((n as unknown as Record<string, unknown>)['title'] as string ?? '').toLowerCase();
        return title.includes(q);
      });
    }

    const conceptIds = (filter as Record<string, unknown> | undefined)?.['conceptIds'] as string[] | undefined;
    if (conceptIds && conceptIds.length > 0) {
      result = result.filter((n) => {
        const nr = n as unknown as Record<string, unknown>;
        const linked = (nr['linkedConceptIds'] ?? nr['linked_concept_ids']) as string[] | undefined ?? [];
        return conceptIds.some((cid) => linked.includes(cid));
      });
    }

    return result;
  }, [notes, filter]);

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
          <Plus size={14} /> New Note
        </button>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {filteredNotes.map((note) => (
          <NoteCard key={note.id} note={note} onClick={() => onOpenNote(note.id)} />
        ))}
      </div>

      {filteredNotes.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {notes && notes.length > 0
            ? 'No notes match the current filters'
            : 'No research notes yet — click "New Note" to start'}
        </div>
      )}

      <CreateNoteDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onOpenNote} />
    </div>
  );
}
