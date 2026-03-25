/**
 * CreateNoteDialog — 新建结构化笔记对话框（§3.3）
 */

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useCreateNote } from '../../../core/ipc/hooks/useNotes';

interface CreateNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (noteId: string) => void;
  /** Pre-fill from memo upgrade */
  prefillTitle?: string;
  prefillLinkedPaperIds?: string[];
  prefillLinkedConceptIds?: string[];
  prefillTags?: string[];
  prefillContent?: string;
}

export function CreateNoteDialog({
  open, onOpenChange, onCreated,
  prefillTitle, prefillLinkedPaperIds, prefillLinkedConceptIds, prefillTags, prefillContent,
}: CreateNoteDialogProps) {
  const [title, setTitle] = useState(prefillTitle ?? '');
  const createNote = useCreateNote();

  const handleCreate = useCallback(() => {
    if (!title.trim()) return;
    const newNote: import('../../../../shared-types/models').NewNote = {
      title: title.trim(),
    };
    if (prefillLinkedPaperIds !== undefined) newNote.linkedPaperIds = prefillLinkedPaperIds;
    if (prefillLinkedConceptIds !== undefined) newNote.linkedConceptIds = prefillLinkedConceptIds;
    if (prefillTags !== undefined) newNote.tags = prefillTags;
    if (prefillContent !== undefined) newNote.initialContent = prefillContent;
    createNote.mutate(
      newNote,
      {
        onSuccess: (result) => {
          onOpenChange(false);
          onCreated(result.noteId);
          setTitle('');
        },
      },
    );
  }, [title, createNote, onOpenChange, onCreated, prefillLinkedPaperIds, prefillLinkedConceptIds, prefillTags, prefillContent]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1000 }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 440, backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md,8px)',
          padding: 24, zIndex: 1001, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}>
          <Dialog.Title style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            新建结构化笔记
          </Dialog.Title>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>标题</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入笔记标题..."
              autoFocus
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm,4px)', fontSize: 13, color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-surface-low)', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </label>

          {/* TODO: linked papers/concepts/tags selectors */}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Dialog.Close asChild>
              <button style={{ padding: '6px 16px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || createNote.isPending}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 4,
                backgroundColor: 'var(--accent-color)', color: '#fff', fontSize: 13,
                cursor: title.trim() ? 'pointer' : 'default', opacity: title.trim() ? 1 : 0.5,
              }}
            >
              {createNote.isPending ? '创建中...' : '创建'}
            </button>
          </div>

          <Dialog.Close asChild>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={16} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
