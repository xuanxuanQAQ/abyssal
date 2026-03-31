/**
 * UnifiedEditor — Single editor component for the full article document.
 *
 * Replaces per-section SectionEditor with a unified doc > section+ editor.
 * - Loads full document from all sections on article change
 * - Auto-saves changed sections via debounced diff
 * - Exposes scrollToSection API for outline clicks
 * - Integrates AI operations scoped to the current section
 */

import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { useAppStore } from '../../../core/store';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { useAIOperations } from '../ai/useAIOperations';
import { EditorToolbar } from './EditorToolbar';
import { TiptapEditor } from './TiptapEditor';
import { FloatingToolbar } from './FloatingToolbar';
import { assembleDocument, disassembleDocument, contentHash } from './documentAssembler';
import { useDocumentAutoSave } from '../hooks/useDocumentAutoSave';
import { useImageUpload } from './ImageUploadHandler';
import { getAPI } from '../../../core/ipc/bridge';
import type { FullDocumentContent } from '../../../../shared-types/models';

interface UnifiedEditorProps {
  articleId: string;
}

export function UnifiedEditor({ articleId }: UnifiedEditorProps) {
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const aiGenerating = useEditorStore((s) => s.aiGenerating);
  const unsavedChanges = useEditorStore((s) => s.unsavedChanges);

  const [documentJson, setDocumentJson] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const loadedArticleRef = useRef<string | null>(null);

  const handleEditorReady = useCallback((ed: Editor) => {
    setEditor(ed);
  }, []);

  // ── Auto-save ──
  const { scheduleAutoSave, flushSave, resetHashes } = useDocumentAutoSave({
    editor,
    articleId,
  });

  // ── Load full document ──
  useEffect(() => {
    if (!articleId || articleId === loadedArticleRef.current) return;

    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      try {
        const doc: FullDocumentContent = await (getAPI() as any).db.articles.getFullDocument(articleId);
        if (cancelled) return;

        const assembled = assembleDocument(doc.sections);
        setDocumentJson(assembled);

        // Initialize content hashes for change detection
        const hashes = new Map<string, string>();
        for (const section of doc.sections) {
          if (section.documentJson) {
            try {
              const parsed = JSON.parse(section.documentJson);
              hashes.set(section.sectionId, contentHash(parsed));
            } catch {
              hashes.set(section.sectionId, '');
            }
          }
        }
        resetHashes(hashes);
        loadedArticleRef.current = articleId;
      } catch (err) {
        console.error('Failed to load document:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDocument();
    return () => { cancelled = true; };
  }, [articleId, resetHashes]);

  // ── Scroll to section ──
  const scrollToSection = useCallback(
    (sectionId: string) => {
      if (!editor) return;

      let targetPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'section' &&
          node.attrs.sectionId === sectionId
        ) {
          targetPos = pos;
          return false;
        }
        return targetPos === null;
      });

      if (targetPos !== null) {
        editor.commands.setTextSelection(targetPos + 1);
        // Scroll the editor view to the position
        const domNode = editor.view.domAtPos(targetPos + 1);
        if (domNode.node instanceof HTMLElement) {
          domNode.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (domNode.node.parentElement) {
          domNode.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [editor],
  );

  // Scroll when selectedSectionId changes
  useEffect(() => {
    if (selectedSectionId && editor) {
      scrollToSection(selectedSectionId);
    }
  }, [selectedSectionId, scrollToSection, editor]);

  // ── Find which section the cursor is in ──
  const currentSectionId = useMemo(() => {
    if (!editor) return null;
    const { $from } = editor.state.selection;

    // Walk up to find enclosing section node
    for (let depth = $from.depth; depth >= 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === 'section') {
        return node.attrs.sectionId as string;
      }
    }
    return null;
  }, [editor, editor?.state.selection]);

  // ── AI Operations ──
  const aiOps = useAIOperations({
    editor,
    sectionId: currentSectionId,
  });

  // ── Image upload ──
  const { uploadAndInsert: handleInsertImage } = useImageUpload({
    editor,
    articleId,
  });

  // ── Editor callbacks ──
  const handleContentUpdate = useCallback(
    (_html: string) => {
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const handleJsonUpdate = useCallback(
    (_json: object) => {
      // JSON update is used by auto-save via editor.getJSON()
    },
    [],
  );

  const handleAIGenerate = useCallback(() => aiOps.generate(), [aiOps]);
  const handleAIRewrite = useCallback(() => aiOps.rewrite(), [aiOps]);
  const handleAIExpand = useCallback(() => aiOps.expand(), [aiOps]);
  const handleAICancel = useCallback(() => aiOps.cancel(), [aiOps]);
  const handleAICompress = useCallback(() => aiOps.rewrite(), [aiOps]);

  const handleInsertCitation = useCallback(() => {
    editor?.chain().focus().insertContent('[@').run();
  }, [editor]);

  const handleInsertMath = useCallback(() => {
    if (!editor) return;
    const mathNodeType = editor.schema.nodes.mathInline;
    if (mathNodeType) {
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (dispatch) {
          const node = mathNodeType.create({ latex: '' });
          tr.replaceSelectionWith(node);
        }
        return true;
      }).run();
    }
  }, [editor]);

  // ── Loading state ──
  if (loading || !documentJson) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', fontSize: 'var(--text-sm)',
      }}>
        正在加载文档…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* ── Title bar ── */}
      <div style={{ padding: '12px 24px 4px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {currentSectionId ? `当前节: ${currentSectionId.slice(0, 8)}…` : '全文编辑模式'}
        </span>
        {unsavedChanges && (
          <span style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            whiteSpace: 'nowrap', flexShrink: 0, userSelect: 'none',
          }} title="有未保存的更改">
            ● 未保存
          </span>
        )}
      </div>

      {/* ── Toolbar ── */}
      <EditorToolbar
        editor={editor}
        aiGenerating={aiGenerating}
        onAIGenerate={handleAIGenerate}
        onAIRewrite={handleAIRewrite}
        onAIExpand={handleAIExpand}
        onAICancel={handleAICancel}
        onInsertCitation={handleInsertCitation}
        onInsertMath={handleInsertMath}
        onInsertImage={handleInsertImage}
      />

      {/* ── Editor ── */}
      <TiptapEditor
        content=""
        contentJson={documentJson}
        onUpdate={handleContentUpdate}
        onJsonUpdate={handleJsonUpdate}
        onEditorReady={handleEditorReady}
        unifiedMode
      />

      {/* ── Floating toolbar ── */}
      {editor && (
        <FloatingToolbar
          editor={editor}
          onAIRewrite={handleAIRewrite}
          onAIExpand={handleAIExpand}
          onAICompress={handleAICompress}
        />
      )}
    </div>
  );
}
