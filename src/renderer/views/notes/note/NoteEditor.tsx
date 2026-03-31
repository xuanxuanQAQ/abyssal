/**
 * NoteEditor — 结构化笔记编辑器（§3.3）
 *
 * Uses Tiptap for rich-text editing with markdown serialization.
 * Now includes metadata editing panel (title, tags, linked papers/concepts).
 * frontmatter 容错解析：解析失败时仍保存文件内容，显示黄色警告条。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle, ChevronDown, ChevronUp, Plus, X, Tag, FileText, Lightbulb } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import { useNote, useNoteFileContent, useSaveNoteFile, useUpdateNoteMeta } from '../../../core/ipc/hooks/useNotes';
import { useConceptList } from '../../../core/ipc/hooks/useConcepts';
import { usePaperList } from '../../../core/ipc/hooks/usePapers';

interface NoteEditorProps {
  noteId: string;
  onBack: () => void;
}

// Frontmatter regex: --- ... --- followed by body
const FM_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function stripFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(FM_REGEX);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
}

function createNoteExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    Highlight,
    Subscript,
    Superscript,
    Placeholder.configure({ placeholder }),
  ];
}

export function NoteEditor({ noteId, onBack }: NoteEditorProps) {
  const { t } = useTranslation();
  const { data: noteMeta } = useNote(noteId);
  const { data: initialContent, isLoading } = useNoteFileContent(noteId);
  const saveMutation = useSaveNoteFile();
  const updateMetaMutation = useUpdateNoteMeta();
  const [frontmatterError, setFrontmatterError] = useState<string | null>(null);
  const frontmatterRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentInitialized = useRef(false);

  // ── Metadata editing state ──
  const [metaOpen, setMetaOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [editPaperIds, setEditPaperIds] = useState<string[]>([]);
  const [editConceptIds, setEditConceptIds] = useState<string[]>([]);
  const [paperSearch, setPaperSearch] = useState('');
  const [conceptSearch, setConceptSearch] = useState('');

  const { data: papers } = usePaperList();
  const { data: concepts } = useConceptList();

  // Sync metadata state when noteMeta loads
  useEffect(() => {
    if (noteMeta) {
      setEditTitle(noteMeta.title);
      setEditTags(noteMeta.tags ?? []);
      setEditPaperIds(noteMeta.linkedPaperIds ?? []);
      setEditConceptIds(noteMeta.linkedConceptIds ?? []);
    }
  }, [noteMeta]);

  const handleEditorUpdate = useCallback(
    ({ editor: ed }: { editor: Editor }) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (ed.isDestroyed) return;
        const html = ed.getHTML();
        const fullContent = frontmatterRef.current + html;
        saveMutation.mutate(
          { noteId, content: fullContent },
          {
            onSuccess: (result) => {
              if (!result.frontmatterValid) {
                setFrontmatterError(result.frontmatterError ?? t('notes.note.frontmatterError'));
              } else {
                setFrontmatterError(null);
              }
            },
          },
        );
      }, 1500);
    },
    [noteId, saveMutation, t],
  );

  const editor = useEditor({
    extensions: createNoteExtensions(t('notes.note.startWriting')),
    onUpdate: handleEditorUpdate,
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'tiptap-editor-content note-editor-content' },
    },
  });

  // Initialize editor content when data loads
  useEffect(() => {
    if (initialContent !== undefined && editor && !contentInitialized.current) {
      contentInitialized.current = true;
      const { frontmatter, body } = stripFrontmatter(initialContent);
      frontmatterRef.current = frontmatter;
      editor.commands.setContent(body || '<p></p>', false);
      // Focus at end after content is set
      requestAnimationFrame(() => {
        editor.commands.focus('end');
      });
    }
  }, [initialContent, editor]);

  // Reset on noteId change
  useEffect(() => {
    contentInitialized.current = false;
  }, [noteId]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // ── Metadata save ──
  const metaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const saveMetadata = useCallback((patch: {
    title?: string; tags?: string[];
    linkedPaperIds?: string[]; linkedConceptIds?: string[];
  }) => {
    clearTimeout(metaDebounceRef.current);
    metaDebounceRef.current = setTimeout(() => {
      updateMetaMutation.mutate({ noteId, patch });
    }, 800);
  }, [noteId, updateMetaMutation]);

  useEffect(() => () => clearTimeout(metaDebounceRef.current), []);

  const handleTitleChange = (val: string) => {
    setEditTitle(val);
    saveMetadata({ title: val });
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      const next = [...editTags, trimmed];
      setEditTags(next);
      saveMetadata({ tags: next });
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    const next = editTags.filter((t) => t !== tag);
    setEditTags(next);
    saveMetadata({ tags: next });
  };

  const handleTogglePaper = (pid: string) => {
    const next = editPaperIds.includes(pid)
      ? editPaperIds.filter((id) => id !== pid)
      : [...editPaperIds, pid];
    setEditPaperIds(next);
    saveMetadata({ linkedPaperIds: next });
    setPaperSearch('');
  };

  const handleToggleConcept = (cid: string) => {
    const next = editConceptIds.includes(cid)
      ? editConceptIds.filter((id) => id !== cid)
      : [...editConceptIds, cid];
    setEditConceptIds(next);
    saveMetadata({ linkedConceptIds: next });
    setConceptSearch('');
  };

  const filteredPapers = (papers ?? [])
    .filter((p) => {
      const pr = p as unknown as Record<string, unknown>;
      const pTitle = (pr['title'] as string) ?? '';
      return pTitle.toLowerCase().includes(paperSearch.toLowerCase()) && !editPaperIds.includes((pr['id'] as string) ?? '');
    })
    .slice(0, 5);

  const filteredConcepts = (concepts ?? [])
    .filter((c) => {
      const cr = c as unknown as Record<string, unknown>;
      const name = ((cr['nameEn'] ?? cr['name_en'] ?? cr['id']) as string) ?? '';
      return name.toLowerCase().includes(conceptSearch.toLowerCase()) && !editConceptIds.includes((cr['id'] as string) ?? '');
    })
    .slice(0, 5);

  if (isLoading || !editor) {
    return <div style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center' }}>{t('common.loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
        }}>
          <ArrowLeft size={14} /> {t('notes.note.backToList')}
        </button>

        <div style={{ flex: 1 }} />

        {saveMutation.isPending && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notes.note.saving')}</span>
        )}
        {updateMetaMutation.isPending && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('notes.note.saving', '保存中...')}</span>
        )}

        {/* Metadata toggle */}
        <button
          onClick={() => setMetaOpen(!metaOpen)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
            border: '1px solid var(--border-subtle)', borderRadius: 4,
            background: metaOpen ? 'var(--bg-surface-high, var(--bg-surface))' : 'transparent',
            color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          }}
        >
          {t('notes.note.metadata', '属性')}
          {metaOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Frontmatter warning */}
      {frontmatterError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
          backgroundColor: '#FEF3C7', color: '#92400E', fontSize: 12,
        }}>
          <AlertTriangle size={14} />
          {t('notes.note.frontmatterError')}
        </div>
      )}

      {/* ── Metadata editing panel ── */}
      {metaOpen && (
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface-low, var(--bg-surface))',
          display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
        }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>{t('notes.note.titleLabel', '标题')}</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Tags */}
          <div>
            <label style={labelStyle}>
              <Tag size={11} /> {t('common.tags', '标签')}
            </label>
            {editTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {editTags.map((tag) => (
                  <span key={tag} style={chipStyle('var(--text-muted, #6B7280)')}>
                    #{tag}
                    <button onClick={() => handleRemoveTag(tag)} style={chipRemoveStyle}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text" value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); handleAddTag(); } }}
                placeholder={t('notes.create.addTag', '添加标签')}
                style={{ ...inputStyle, flex: 1, fontSize: 12 }}
              />
              <button
                onClick={handleAddTag} disabled={!tagInput.trim()}
                style={{
                  padding: '4px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4,
                  background: 'transparent', color: 'var(--text-secondary)', cursor: tagInput.trim() ? 'pointer' : 'default',
                  fontSize: 12, display: 'flex', alignItems: 'center',
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* Linked Papers */}
          <div>
            <label style={labelStyle}>
              <FileText size={11} /> {t('notes.create.linkedPapers', '关联论文')}
            </label>
            {editPaperIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {editPaperIds.map((pid) => {
                  const paper = (papers ?? []).find((p) => ((p as unknown as Record<string, unknown>)['id'] as string) === pid);
                  const pTitle = paper ? ((paper as unknown as Record<string, unknown>)['title'] as string)?.slice(0, 40) : pid.slice(0, 12);
                  return (
                    <span key={pid} style={chipStyle('var(--color-paper-tag, #3B82F6)')}>
                      {pTitle}
                      <button onClick={() => handleTogglePaper(pid)} style={chipRemoveStyle}><X size={10} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <input
                type="text" value={paperSearch}
                onChange={(e) => setPaperSearch(e.target.value)}
                placeholder={t('notes.create.searchPapers', '搜索论文')}
                style={{ ...inputStyle, fontSize: 12 }}
              />
              {paperSearch && filteredPapers.length > 0 && (
                <div style={dropdownStyle}>
                  {filteredPapers.map((p) => {
                    const pr = p as unknown as Record<string, unknown>;
                    const pid = (pr['id'] as string) ?? '';
                    const pTitle = ((pr['title'] as string) ?? '').slice(0, 60);
                    return (
                      <button key={pid} onClick={() => handleTogglePaper(pid)} style={dropdownItemStyle}>
                        {pTitle || pid.slice(0, 12)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Linked Concepts */}
          <div>
            <label style={labelStyle}>
              <Lightbulb size={11} /> {t('notes.create.linkedConcepts', '关联概念')}
            </label>
            {editConceptIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {editConceptIds.map((cid) => {
                  const concept = (concepts ?? []).find((c) => ((c as unknown as Record<string, unknown>)['id'] as string) === cid);
                  const cName = concept ? ((concept as unknown as Record<string, unknown>)['nameEn'] ?? (concept as unknown as Record<string, unknown>)['name_en'] ?? cid) as string : cid;
                  return (
                    <span key={cid} style={chipStyle('var(--color-concept-tag, #10B981)')}>
                      {cName}
                      <button onClick={() => handleToggleConcept(cid)} style={chipRemoveStyle}><X size={10} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <input
                type="text" value={conceptSearch}
                onChange={(e) => setConceptSearch(e.target.value)}
                placeholder={t('notes.create.searchConcepts', '搜索概念')}
                style={{ ...inputStyle, fontSize: 12 }}
              />
              {conceptSearch && filteredConcepts.length > 0 && (
                <div style={dropdownStyle}>
                  {filteredConcepts.map((c) => {
                    const cr = c as unknown as Record<string, unknown>;
                    const cid = (cr['id'] as string) ?? '';
                    const cName = ((cr['nameEn'] ?? cr['name_en'] ?? cid) as string);
                    return (
                      <button key={cid} onClick={() => handleToggleConcept(cid)} style={dropdownItemStyle}>
                        {cName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rich text editor — click anywhere in this area to focus */}
      <div
        style={{ flex: 1, overflow: 'auto', padding: 16, cursor: 'text' }}
        onClick={() => { if (editor && !editor.isFocused) editor.commands.focus(); }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', minHeight: '100%' }}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

// ── Styles ──

const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)', fontSize: 13, color: 'var(--text-primary)',
  backgroundColor: 'var(--bg-surface)', outline: 'none', boxSizing: 'border-box',
};

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 10, fontSize: 11,
    color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
  };
}

const chipRemoveStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'inherit', display: 'flex', alignItems: 'center',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm, 4px)',
  backgroundColor: 'var(--bg-surface)', maxHeight: 120, overflow: 'auto',
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 50,
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 10px', border: 'none',
  background: 'transparent', color: 'var(--text-primary)', fontSize: 12,
  cursor: 'pointer', textAlign: 'left',
};
