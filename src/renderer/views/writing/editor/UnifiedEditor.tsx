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
import { useEditorCommandBridge } from '../ai/useEditorCommandBridge';
import { EditorToolbar } from './EditorToolbar';
import { TiptapEditor } from './TiptapEditor';
import { FloatingToolbar } from './FloatingToolbar';
import { useDocumentAutoSave } from '../hooks/useDocumentAutoSave';
import { useImageUpload } from './ImageUploadHandler';
import { getAPI } from '../../../core/ipc/bridge';
import { contentHash } from '../../../../shared/writing/documentOutline';

interface UnifiedEditorProps {
  articleId: string;
  draftId: string;
  outlineStructureKey: string;
  onDocumentJsonChange?: ((json: JSONContent | null) => void) | undefined;
}

export function UnifiedEditor({ articleId, draftId, outlineStructureKey, onDocumentJsonChange }: UnifiedEditorProps) {
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectSection = useAppStore((s) => s.selectSection);
  const aiGenerating = useEditorStore((s) => s.aiGenerating);
  const unsavedChanges = useEditorStore((s) => s.unsavedChanges);
  const setLiveDocumentState = useEditorStore((s) => s.setLiveDocumentState);
  const clearLiveDocumentState = useEditorStore((s) => s.clearLiveDocumentState);

  const [documentJson, setDocumentJson] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const loadedDocumentKeyRef = useRef<string | null>(null);

  const handleEditorReady = useCallback((ed: Editor) => {
    setEditor(ed);
  }, []);

  // ── Auto-save ──
  const { scheduleAutoSave, flushSave, resetHashes } = useDocumentAutoSave({
    editor,
    draftId,
  });

  useEditorCommandBridge({
    editor,
    articleId,
    persistDocument: flushSave,
  });

  // ── Load full document ──
  useEffect(() => {
    if (!draftId) return;

    const documentKey = `${draftId}:${outlineStructureKey}`;
    if (documentKey === loadedDocumentKeyRef.current) return;

    let cancelled = false;

    async function loadDocument() {
      setLoading(true);
      try {
        const payload = await getAPI().db.drafts.getDocument(draftId);
        if (cancelled) return;

        const nextDocumentJson = payload.documentJson;
        const parsed = JSON.parse(nextDocumentJson) as JSONContent;
        const currentDocumentJson = editor && !editor.isDestroyed
          ? JSON.stringify(editor.getJSON())
          : null;

        if (currentDocumentJson !== nextDocumentJson || loadedDocumentKeyRef.current !== documentKey) {
          setDocumentJson(parsed);
          onDocumentJsonChange?.(parsed);
        }
        resetHashes(nextDocumentJson);
        setLiveDocumentState({
          articleId,
          draftId,
          documentJson: nextDocumentJson,
          documentHash: contentHash(parsed),
        });
        loadedDocumentKeyRef.current = documentKey;
      } catch (err) {
        console.error('Failed to load document:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDocument();
    return () => { cancelled = true; };
  }, [articleId, draftId, outlineStructureKey, resetHashes, editor, onDocumentJsonChange, setLiveDocumentState]);

  useEffect(() => {
    return () => {
      clearLiveDocumentState();
    };
  }, [clearLiveDocumentState]);

  // ── Scroll to section ──
  const scrollToSection = useCallback(
    (sectionId: string) => {
      if (!editor) return;

      let targetPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === 'heading' &&
          Number(node.attrs.level ?? 0) >= 1 &&
          Number(node.attrs.level ?? 0) <= 3 &&
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
  const currentSectionId = useMemo<string | null>(() => {
    if (!editor) return null;
    const selectionPos = editor.state.selection.from;
    let activeSectionId: string | null = null;

    editor.state.doc.descendants((node, pos) => {
      if (pos > selectionPos) return false;
      if (
        node.type.name === 'heading' &&
        Number(node.attrs.level ?? 0) >= 1 &&
        Number(node.attrs.level ?? 0) <= 3 &&
        typeof node.attrs.sectionId === 'string'
      ) {
        activeSectionId = node.attrs.sectionId as string;
      }
      return true;
    });

    return activeSectionId;
  }, [editor, editor?.state.selection]);

  // ── AI Operations ──
  const aiOps = useAIOperations({
    editor,
    articleId,
    draftId,
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
    (json: object) => {
      const typedJson = json as JSONContent;
      setLiveDocumentState({
        articleId,
        draftId,
        documentJson: typedJson,
        documentHash: contentHash(typedJson),
      });
      onDocumentJsonChange?.(typedJson);
    },
    [articleId, draftId, onDocumentJsonChange, setLiveDocumentState],
  );

  const handleAIGenerate = useCallback(() => aiOps.generate(), [aiOps]);
  const handleAIRewrite = useCallback(() => aiOps.rewrite(), [aiOps]);
  const handleAIExpand = useCallback(() => aiOps.expand(), [aiOps]);
  const handleAICancel = useCallback(() => aiOps.cancel(), [aiOps]);
  const handleAICompress = useCallback(() => aiOps.compress(), [aiOps]);

  const handleInsertCitation = useCallback(() => {
    editor?.chain().focus().insertContent('[@').run();
  }, [editor]);

  const handleInsertMath = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    const isCollapsed = selection.from === selection.to;
    const parent = selection.$from.parent;
    const isEmptyParagraph = parent.type.name === 'paragraph' && parent.textContent.length === 0;
    const insertBlock = isCollapsed && isEmptyParagraph;

    const mathNodeType = insertBlock
      ? editor.schema.nodes.mathBlock
      : editor.schema.nodes.mathInline;

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'linear-gradient(180deg, var(--paper-surface) 0%, var(--paper-surface-muted) 100%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {/* ── Title bar ── */}
        <div style={{ padding: '12px 24px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
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
      </div>

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
