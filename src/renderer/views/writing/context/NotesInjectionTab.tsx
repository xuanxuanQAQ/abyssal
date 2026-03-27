/**
 * NotesInjectionTab — drag-and-drop notes panel for Writing view.
 *
 * Displays memos and notes related to the current section's concepts/papers.
 * Items are draggable — drop into TiptapEditor to inject text.
 *
 * See spec: section 4.4
 */

import React, { useMemo } from 'react';
import { StickyNote, FileText, GripVertical } from 'lucide-react';
import { useMemoList } from '../../../core/ipc/hooks/useMemos';
import { useNoteList } from '../../../core/ipc/hooks/useNotes';

// ─── Props ───

interface NotesInjectionTabProps {
  /** Concept IDs from the current outline section */
  conceptIds: string[];
  /** Paper IDs from the current outline section */
  paperIds: string[];
  /** Called when a note/memo is dragged onto the editor */
  onInject?: (text: string, type: 'memo' | 'note') => void;
}

// ─── Component ───

export function NotesInjectionTab({ conceptIds, paperIds, onInject }: NotesInjectionTabProps) {
  // Query memos linked to section's concepts and papers
  const { data: memoData } = useMemoList(
    conceptIds.length > 0 || paperIds.length > 0
      ? { conceptIds, paperIds } as Record<string, unknown>
      : {},
  );
  const memos = memoData?.pages.flat() ?? [];

  // Query notes linked to section's concepts
  const { data: notes } = useNoteList();
  const relevantNotes = useMemo(() => {
    if (!notes || conceptIds.length === 0) return [];
    return notes.filter((n) => {
      const nr = n as unknown as Record<string, unknown>;
      const linked = (nr['linkedConceptIds'] ?? nr['linked_concept_ids']) as string[] | undefined ?? [];
      return conceptIds.some((cid) => linked.includes(cid));
    });
  }, [notes, conceptIds]);

  const handleDragStart = (e: React.DragEvent, text: string, type: 'memo' | 'note') => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData('application/x-abyssal-inject', JSON.stringify({ type, text }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 8, fontSize: 12 }}>
      {/* Memos section */}
      {memos.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <StickyNote size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
            Memos ({memos.length})
          </div>
          {memos.map((memo) => (
            <div
              key={(memo as unknown as Record<string, unknown>)['id'] as string}
              draggable
              onDragStart={(e) => handleDragStart(e, ((memo as unknown as Record<string, unknown>)['text'] as string) ?? '', 'memo')}
              onClick={() => onInject?.(((memo as unknown as Record<string, unknown>)['text'] as string) ?? '', 'memo')}
              style={{
                padding: '6px 8px', marginBottom: 4,
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm, 4px)',
                background: 'var(--bg-surface-low, var(--bg-surface))',
                cursor: 'grab', display: 'flex', gap: 6, alignItems: 'flex-start',
              }}
            >
              <GripVertical size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const }}>
                {((memo as unknown as Record<string, unknown>)['text'] as string) ?? ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes section */}
      {relevantNotes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <FileText size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
            Notes ({relevantNotes.length})
          </div>
          {relevantNotes.map((note) => (
            <div
              key={(note as unknown as Record<string, unknown>)['id'] as string}
              draggable
              onDragStart={(e) => {
                const title = ((note as unknown as Record<string, unknown>)['title'] as string) ?? '';
                const preview = title ? `## ${title}\n\n` : '';
                handleDragStart(e, preview, 'note');
              }}
              onClick={() => {
                const title = (note['title'] as string) ?? '';
                onInject?.(`## ${title}\n\n`, 'note');
              }}
              style={{
                padding: '6px 8px', marginBottom: 4,
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm, 4px)',
                background: 'var(--bg-surface-low, var(--bg-surface))',
                cursor: 'grab', display: 'flex', gap: 6, alignItems: 'center',
              }}
            >
              <GripVertical size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {(note['title'] as string) ?? 'Untitled'}
              </span>
            </div>
          ))}
        </div>
      )}

      {memos.length === 0 && relevantNotes.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          No related memos or notes for this section
        </div>
      )}
    </div>
  );
}
