/**
 * CreateNoteDialog — 新建结构化笔记对话框（§3.3）
 *
 * Supports linking papers, concepts, and tags at creation time.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, FileText, Lightbulb, Tag } from 'lucide-react';
import { useCreateNote } from '../../../core/ipc/hooks/useNotes';
import { useConceptList } from '../../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../../core/ipc/hooks/usePapers';

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
  const { t } = useTranslation();
  const [title, setTitle] = useState(prefillTitle ?? '');
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>(prefillLinkedPaperIds ?? []);
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(prefillLinkedConceptIds ?? []);
  const [tags, setTags] = useState<string[]>(prefillTags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [paperSearch, setPaperSearch] = useState('');
  const [conceptSearch, setConceptSearch] = useState('');
  const createNote = useCreateNote();

  const { data: papers } = usePaperList();
  const { data: concepts } = useConceptList();

  const filteredPapers = (papers ?? [])
    .filter((p) => {
      const pr = p as unknown as Record<string, unknown>;
      const pTitle = (pr['title'] as string) ?? '';
      return pTitle.toLowerCase().includes(paperSearch.toLowerCase()) && !selectedPaperIds.includes((pr['id'] as string) ?? '');
    })
    .slice(0, 5);

  const filteredConcepts = (concepts ?? [])
    .filter((c) => {
      const cr = c as unknown as Record<string, unknown>;
      const name = ((cr['nameEn'] ?? cr['name_en'] ?? cr['id']) as string) ?? '';
      return name.toLowerCase().includes(conceptSearch.toLowerCase()) && !selectedConceptIds.includes((cr['id'] as string) ?? '');
    })
    .slice(0, 5);

  const handleCreate = useCallback(() => {
    if (!title.trim()) return;
    const newNote: import('../../../../shared-types/models').NewNote = {
      title: title.trim(),
    };
    if (selectedPaperIds.length > 0) newNote.linkedPaperIds = selectedPaperIds;
    if (selectedConceptIds.length > 0) newNote.linkedConceptIds = selectedConceptIds;
    if (tags.length > 0) newNote.tags = tags;
    if (prefillContent !== undefined) newNote.initialContent = prefillContent;
    createNote.mutate(
      newNote,
      {
        onSuccess: (result) => {
          onOpenChange(false);
          onCreated(result.noteId);
          // Reset form
          setTitle('');
          setSelectedPaperIds([]);
          setSelectedConceptIds([]);
          setTags([]);
          setTagInput('');
        },
      },
    );
  }, [title, selectedPaperIds, selectedConceptIds, tags, prefillContent, createNote, onOpenChange, onCreated]);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  }, [tagInput, tags]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    }
  }, [handleAddTag]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 1000 }} />
        <Dialog.Content style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 500, maxHeight: '80vh', overflow: 'auto',
          backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-md,8px)',
          padding: 24, zIndex: 1001, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}>
          <Dialog.Title style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
            {t('notes.note.createTitle')}
          </Dialog.Title>

          {/* Title */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{t('notes.note.titleLabel')}</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('notes.note.titlePlaceholder')}
              autoFocus
              style={inputStyle}
            />
          </label>

          {/* Linked Papers */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <FileText size={12} /> {t('notes.create.linkedPapers')}
            </span>
            {selectedPaperIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {selectedPaperIds.map((pid) => {
                  const paper = (papers ?? []).find((p) => ((p as unknown as Record<string, unknown>)['id'] as string) === pid);
                  const pTitle = paper ? ((paper as unknown as Record<string, unknown>)['title'] as string)?.slice(0, 40) : pid.slice(0, 12);
                  return (
                    <span key={pid} style={chipStyle('#3B82F6')}>
                      {pTitle}
                      <button onClick={() => setSelectedPaperIds(selectedPaperIds.filter((id) => id !== pid))} style={chipRemoveStyle}>
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={paperSearch}
              onChange={(e) => setPaperSearch(e.target.value)}
              placeholder={t('notes.create.searchPapers')}
              style={{ ...inputStyle, fontSize: 12 }}
            />
            {paperSearch && filteredPapers.length > 0 && (
              <div style={dropdownStyle}>
                {filteredPapers.map((p) => {
                  const pr = p as unknown as Record<string, unknown>;
                  const pid = (pr['id'] as string) ?? '';
                  const pTitle = ((pr['title'] as string) ?? '').slice(0, 60);
                  return (
                    <button
                      key={pid}
                      onClick={() => { setSelectedPaperIds([...selectedPaperIds, pid]); setPaperSearch(''); }}
                      style={dropdownItemStyle}
                    >
                      {pTitle || pid.slice(0, 12)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Linked Concepts */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Lightbulb size={12} /> {t('notes.create.linkedConcepts')}
            </span>
            {selectedConceptIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {selectedConceptIds.map((cid) => {
                  const concept = (concepts ?? []).find((c) => ((c as unknown as Record<string, unknown>)['id'] as string) === cid);
                  const cName = concept ? ((concept as unknown as Record<string, unknown>)['nameEn'] ?? (concept as unknown as Record<string, unknown>)['name_en'] ?? cid) as string : cid;
                  return (
                    <span key={cid} style={chipStyle('#10B981')}>
                      {cName}
                      <button onClick={() => setSelectedConceptIds(selectedConceptIds.filter((id) => id !== cid))} style={chipRemoveStyle}>
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              value={conceptSearch}
              onChange={(e) => setConceptSearch(e.target.value)}
              placeholder={t('notes.create.searchConcepts')}
              style={{ ...inputStyle, fontSize: 12 }}
            />
            {conceptSearch && filteredConcepts.length > 0 && (
              <div style={dropdownStyle}>
                {filteredConcepts.map((c) => {
                  const cr = c as unknown as Record<string, unknown>;
                  const cid = (cr['id'] as string) ?? '';
                  const cName = ((cr['nameEn'] ?? cr['name_en'] ?? cid) as string);
                  return (
                    <button
                      key={cid}
                      onClick={() => { setSelectedConceptIds([...selectedConceptIds, cid]); setConceptSearch(''); }}
                      style={dropdownItemStyle}
                    >
                      {cName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Tag size={12} /> {t('common.tags')}
            </span>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {tags.map((tag) => (
                  <span key={tag} style={chipStyle('#6B7280')}>
                    #{tag}
                    <button onClick={() => setTags(tags.filter((t) => t !== tag))} style={chipRemoveStyle}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={t('notes.create.addTag')}
                style={{ ...inputStyle, fontSize: 12, flex: 1 }}
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                style={{
                  padding: '4px 8px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm,4px)',
                  background: 'transparent', color: 'var(--text-secondary)', cursor: tagInput.trim() ? 'pointer' : 'default',
                  fontSize: 12, display: 'flex', alignItems: 'center',
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Dialog.Close asChild>
              <button style={{ padding: '6px 16px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>
                {t('common.cancel')}
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
              {createNote.isPending ? t('notes.note.creating') : t('common.create')}
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

// ── Shared styles ──

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm,4px)', fontSize: 13, color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-surface-low)', outline: 'none', boxSizing: 'border-box',
};

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 10, fontSize: 11,
    color, backgroundColor: `${color}12`, border: `1px solid ${color}30`,
  };
}

const chipRemoveStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'inherit', display: 'flex', alignItems: 'center',
};

const dropdownStyle: React.CSSProperties = {
  marginTop: 4, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm,4px)',
  backgroundColor: 'var(--bg-surface)', maxHeight: 120, overflow: 'auto',
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 10px', border: 'none',
  background: 'transparent', color: 'var(--text-primary)', fontSize: 12,
  cursor: 'pointer', textAlign: 'left',
};
