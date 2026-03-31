/**
 * SectionEditor -- container composing the full section editing experience
 *
 * Composes:
 *   SectionTitleInput  — editable section title with numbering prefix
 *   EditorToolbar      — fixed formatting / AI toolbar
 *   TiptapEditor       — core ProseMirror-based rich-text editor
 *   FloatingToolbar    — BubbleMenu on text selection
 *
 * Responsibilities:
 *   - Reads the currently-selected section from store + TanStack Query.
 *   - Manages section-switch flow (save current -> load new).
 *   - Connects AI operations from toolbar buttons to useAIOperations.
 *   - Shows an unsaved-changes indicator next to the title.
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../../core/store';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { useSection, useUpdateSection } from '../../../core/ipc/hooks/useArticles';
import { useOutlineData } from '../hooks/useOutlineData';
import { useAIOperations } from '../ai/useAIOperations';
import { SectionTitleInput } from './SectionTitleInput';
import { EditorToolbar } from './EditorToolbar';
import { TiptapEditor, type TiptapEditorHandle } from './TiptapEditor';
import { FloatingToolbar } from './FloatingToolbar';
import { countWords } from './hooks/useWordCount';

// ── Constants ──

const AUTO_SAVE_DEBOUNCE_MS = 1_500;

// ── Component ──

export function SectionEditor() {
  const selectedSectionId = useAppStore((s) => s.selectedSectionId);
  const selectedArticleId = useAppStore((s) => s.selectedArticleId);
  const aiGenerating = useEditorStore((s) => s.aiGenerating);
  const unsavedChanges = useEditorStore((s) => s.unsavedChanges);
  const setUnsavedChanges = useEditorStore((s) => s.setUnsavedChanges);

  const editorRef = useRef<TiptapEditorHandle>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<string | null>(null);

  // ── Data ──

  const { data: sectionData } = useSection(selectedSectionId);
  const updateSection = useUpdateSection();
  const outlineData = useOutlineData(selectedArticleId);

  // Derive numbering and title from outline data
  const numbering = useMemo(() => {
    if (!selectedSectionId) return '';
    return outlineData.numbering[selectedSectionId] ?? '';
  }, [selectedSectionId, outlineData.numbering]);

  const sectionTitleFromOutline = useMemo(() => {
    if (!selectedSectionId) return '';
    function findTitle(nodes: typeof outlineData.sections): string {
      for (const node of nodes) {
        if (node.id === selectedSectionId) return node.title;
        if (node.children.length > 0) {
          const found = findTitle(node.children);
          if (found) return found;
        }
      }
      return '';
    }
    return findTitle(outlineData.sections);
  }, [selectedSectionId, outlineData.sections]);

  // ── AI Operations ──

  const editor = editorRef.current?.getEditor() ?? null;

  const aiOps = useAIOperations({
    editor,
    sectionId: selectedSectionId,
  });

  // ── Auto-save flush ──

  const flushSave = useCallback(() => {
    if (autoSaveTimer.current !== null) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }

    const content = pendingContentRef.current;
    if (content === null || selectedSectionId === null) return;

    pendingContentRef.current = null;
    const wordCount = countWords(content);

    updateSection.mutate(
      { sectionId: selectedSectionId, patch: { content, wordCount } },
      {
        onSuccess: () => {
          setUnsavedChanges(false);
        },
      },
    );
  }, [selectedSectionId, updateSection, setUnsavedChanges]);

  // Flush pending save on section switch or unmount.
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current !== null) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      // Synchronous flush: fire-and-forget the mutation.
      if (pendingContentRef.current !== null) {
        flushSave();
      }
    };
  }, [selectedSectionId, flushSave]);

  // ── Callbacks ──

  const handleContentUpdate = useCallback(
    (html: string) => {
      pendingContentRef.current = html;
      setUnsavedChanges(true);

      if (autoSaveTimer.current !== null) {
        clearTimeout(autoSaveTimer.current);
      }

      autoSaveTimer.current = setTimeout(() => {
        autoSaveTimer.current = null;
        flushSave();
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [flushSave, setUnsavedChanges],
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (selectedSectionId === null) return;
      updateSection.mutate({ sectionId: selectedSectionId, patch: { title } });
    },
    [selectedSectionId, updateSection],
  );

  const handleEnterPress = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  // ── AI operation callbacks (wired to useAIOperations) ──

  const handleAIGenerate = useCallback(() => {
    aiOps.generate();
  }, [aiOps]);

  const handleAIRewrite = useCallback(() => {
    aiOps.rewrite();
  }, [aiOps]);

  const handleAIExpand = useCallback(() => {
    aiOps.expand();
  }, [aiOps]);

  const handleAICancel = useCallback(() => {
    aiOps.cancel();
  }, [aiOps]);

  const handleAICompress = useCallback(() => {
    // Compress reuses rewrite with the full doc content as context
    // For now, map to rewrite (selection-based compression)
    aiOps.rewrite();
  }, [aiOps]);

  const handleInsertCitation = useCallback(() => {
    // Insert `[@` to trigger the CitationAutocomplete plugin
    if (!editor) return;
    editor.chain().focus().insertContent('[@').run();
  }, [editor]);

  const handleInsertMath = useCallback(() => {
    // Insert an inline math node placeholder
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
    } else {
      // Fallback: insert LaTeX delimiters
      editor.chain().focus().insertContent('$  $').run();
      // Move cursor inside the delimiters
      const { state } = editor;
      const pos = state.selection.from - 2;
      editor.commands.setTextSelection(pos);
    }
  }, [editor]);

  // ── No section selected ──

  if (selectedSectionId === null) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          userSelect: 'none',
        }}
      >
        在大纲中选择一个节以开始编辑
      </div>
    );
  }

  const sectionContent = sectionData?.content ?? '';
  const sectionTitle = sectionTitleFromOutline;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* ── Title row ── */}
      <div
        style={{
          padding: '16px 24px 8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SectionTitleInput
            numbering={numbering}
            title={sectionTitle}
            onTitleChange={handleTitleChange}
            onEnterPress={handleEnterPress}
          />

          {/* Unsaved indicator */}
          {unsavedChanges && (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                userSelect: 'none',
              }}
              title="有未保存的更改"
            >
              ● 未保存
            </span>
          )}
        </div>
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
      />

      {/* ── Editor ── */}
      <TiptapEditor
        ref={editorRef}
        content={sectionContent}
        onUpdate={handleContentUpdate}
      />

      {/* ── Floating toolbar (selection-based) ── */}
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
