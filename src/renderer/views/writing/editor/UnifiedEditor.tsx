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
import type { PersistedWritingTarget } from '../../../core/store/useEditorStore';
import { useEditorCommandBridge } from '../ai/useEditorCommandBridge';
import { useSelectionPreview } from '../ai/useSelectionPreview';
import { EditorToolbar } from './EditorToolbar';
import { TiptapEditor } from './TiptapEditor';
import { FloatingToolbar } from './FloatingToolbar';
import { SelectionPreviewOverlay } from './SelectionPreviewOverlay';
import { useDocumentAutoSave } from '../hooks/useDocumentAutoSave';
import { useImageUpload } from './ImageUploadHandler';
import { onCitationInsertRequest } from '../shared/citationActions';
import { useDraftOutline } from '../../../core/ipc/hooks/useDrafts';
import { getAPI } from '../../../core/ipc/bridge';
import { contentHash } from '../../../../shared/writing/documentOutline';
import { useChatStore } from '../../../core/store/useChatStore';

function resolveActiveSectionId(editor: Editor, selectionPos: number): string | null {
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
}

interface UnifiedEditorProps {
  articleId: string;
  draftId: string;
  outlineStructureKey: string;
  onDocumentJsonChange?: ((json: JSONContent | null) => void) | undefined;
}

export function UnifiedEditor({ articleId, draftId, outlineStructureKey, onDocumentJsonChange }: UnifiedEditorProps) {
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectSection = useAppStore((s) => s.selectSection);
  const setLiveDocumentState = useEditorStore((s) => s.setLiveDocumentState);
  const clearLiveDocumentState = useEditorStore((s) => s.clearLiveDocumentState);
  const setEditorSelection = useEditorStore((s) => s.setEditorSelection);
  const setPersistedWritingTarget = useEditorStore((s) => s.setPersistedWritingTarget);

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

  // Selection preview intercepts replace-range patches (Phase 2)
  // Must be registered BEFORE useEditorCommandBridge so stopImmediatePropagation works
  const { preview: selectionPreview, accept: acceptPreview, reject: rejectPreview } = useSelectionPreview({
    editor,
    articleId,
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
    return resolveActiveSectionId(editor, editor.state.selection.from);
  }, [editor, editor?.state.selection]);

  // ── Section paper IDs for citation autocomplete prioritization ──
  const { data: draftOutline } = useDraftOutline(draftId);
  const currentSectionPaperIds = useMemo<string[]>(() => {
    if (!currentSectionId || !draftOutline?.sections) return [];
    const findSection = (nodes: typeof draftOutline.sections): string[] => {
      for (const node of nodes) {
        if (node.id === currentSectionId) return node.paperIds ?? [];
        const found = findSection(node.children);
        if (found.length > 0) return found;
      }
      return [];
    };
    return findSection(draftOutline.sections);
  }, [currentSectionId, draftOutline]);

  useEffect(() => {
    if (!editor) {
      setEditorSelection(null);
      return;
    }

    /**
     * 从选区位置找到最近段落的 pid 属性
     */
    const findAnchorParagraphId = (pos: number): string | null => {
      const resolved = editor.state.doc.resolve(pos);
      for (let depth = resolved.depth; depth >= 0; depth--) {
        const node = resolved.node(depth);
        if (node.type.name === 'paragraph' && typeof node.attrs.pid === 'string') {
          return node.attrs.pid as string;
        }
      }
      return null;
    };

    /**
     * 提取选区前后文本用于锚点重定位
     */
    const getSurroundingText = (from: number, to: number): { beforeText: string; afterText: string } => {
      const docSize = editor.state.doc.content.size;
      const beforeStart = Math.max(0, from - 80);
      const afterEnd = Math.min(docSize, to + 80);
      return {
        beforeText: editor.state.doc.textBetween(beforeStart, from, '\n'),
        afterText: editor.state.doc.textBetween(to, afterEnd, '\n'),
      };
    };

    const syncEditorSelection = () => {
      const { from, to } = editor.state.selection;
      const sectionId = resolveActiveSectionId(editor, from);

      // 跳过无意义的重复更新 — 防止与 ghost selection plugin 形成无限循环
      const prev = useEditorStore.getState().persistedWritingTarget;
      const sameTarget = prev
        && prev.from === from
        && prev.to === (from === to ? from : to)
        && prev.sectionId === sectionId
        && prev.articleId === articleId;

      if (from === to) {
        // 光标（无选区）：更新为 caret target，但不自动展开 ChatDock
        // sectionId 可以为 null（文档无 section 结构时），仍然设置 target
        setEditorSelection(null);
        if (sameTarget && prev?.kind === 'caret') return; // 无变化
        const anchorParagraphId = findAnchorParagraphId(from);
        const { beforeText, afterText } = getSurroundingText(from, from);
        setPersistedWritingTarget({
          kind: 'caret',
          articleId,
          draftId,
          sectionId,
          from,
          to: from,
          selectedText: '',
          anchorParagraphId,
          beforeText,
          afterText,
          capturedAt: Date.now(),
        });
        return;
      }

      const selectedText = editor.state.doc.textBetween(from, to, '\n').trim();
      if (selectedText.length === 0) {
        setEditorSelection(null);
        return;
      }

      setEditorSelection({
        articleId,
        draftId,
        sectionId,
        from,
        to,
        selectedText,
      });

      // 持久化 range target — 仅当选区足够有意义时
      // 短于 8 字符的选区视为阅读/校对行为，不升级为写作操作态
      const SELECTION_THRESHOLD = 8;
      const anchorParagraphId = findAnchorParagraphId(from);
      const { beforeText, afterText } = getSurroundingText(from, to);

      if (selectedText.length >= SELECTION_THRESHOLD) {
        if (sameTarget && prev?.kind === 'range') return; // 无变化
        setPersistedWritingTarget({
          kind: 'range',
          articleId,
          draftId,
          sectionId,
          from,
          to,
          selectedText,
          anchorParagraphId,
          beforeText,
          afterText,
          capturedAt: Date.now(),
        });

        // 有意义的选区时自动展开 ChatDock
        useChatStore.getState().setChatDockMode('expanded');
      }
    };

    syncEditorSelection();
    editor.on('selectionUpdate', syncEditorSelection);

    return () => {
      editor.off('selectionUpdate', syncEditorSelection);
      // 编辑器卸载时清除即时选区，但不清除 persistedWritingTarget
      setEditorSelection(null);
    };
  }, [articleId, draftId, editor, setEditorSelection, setPersistedWritingTarget]);

  // ── AI Operations — now unified through ChatDock, no standalone hooks ──

  // ── Image upload ──
  const { uploadAndInsert: handleInsertImage } = useImageUpload({
    editor,
    articleId,
  });

  // ── External citation insert listener ──
  useEffect(() => {
    if (!editor) return;
    return onCitationInsertRequest(({ paperId, displayText }) => {
      const { view } = editor;
      if (!view || editor.isDestroyed) return;
      const nodeType = view.state.schema.nodes.citationNode;
      if (!nodeType) return;
      const node = nodeType.create({
        paperId,
        displayText: displayText ?? `@${paperId}`,
      });
      editor.chain().focus().insertContent({
        type: 'citationNode',
        attrs: { paperId, displayText: displayText ?? `@${paperId}` },
      }).run();
    });
  }, [editor]);

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden', position: 'relative' }}>
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
        {/* ── Toolbar ── */}
        <EditorToolbar
          editor={editor}
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
        sectionPaperIds={currentSectionPaperIds}
      />

      {/* ── Floating toolbar — formatting only, AI buttons removed ── */}
      {editor && (
        <FloatingToolbar
          editor={editor}
        />
      )}

      {/* ── Selection preview (Phase 2: in-place accept/reject) ── */}
      {selectionPreview && (
        <SelectionPreviewOverlay
          preview={selectionPreview}
          onAccept={acceptPreview}
          onReject={rejectPreview}
        />
      )}
    </div>
  );
}
