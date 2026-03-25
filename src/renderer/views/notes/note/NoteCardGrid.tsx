/**
 * NoteCardGrid — 结构化笔记响应式网格（§3.4）
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { NoteCard } from './NoteCard';
import { CreateNoteDialog } from './CreateNoteDialog';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';

interface NoteCardGridProps {
  onOpenNote: (noteId: string) => void;
}

export function NoteCardGrid({ onOpenNote }: NoteCardGridProps) {
  const { data: notes } = useNoteList();
  const [showCreate, setShowCreate] = React.useState(false);

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
          <Plus size={14} /> 新建笔记
        </button>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {notes?.map((note) => (
          <NoteCard key={note.id} note={note} onClick={() => onOpenNote(note.id)} />
        ))}
      </div>

      {notes?.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          暂无结构化笔记，点击"新建笔记"开始
        </div>
      )}

      <CreateNoteDialog open={showCreate} onOpenChange={setShowCreate} onCreated={onOpenNote} />
    </div>
  );
}
