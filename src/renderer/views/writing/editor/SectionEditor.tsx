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
 *   - Connects AI operations from toolbar buttons to useEditorStore.
 *   - Shows an unsaved-changes indicator next to the title.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../../core/store';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { useSection, useUpdateSection } from '../../../core/ipc/hooks/useArticles';
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
  const aiGenerating = useEditorStore((s) => s.aiGenerating);
  const unsavedChanges = useEditorStore((s) => s.unsavedChanges);
  const setUnsavedChanges = useEditorStore((s) => s.setUnsavedChanges);

  const editorRef = useRef<TiptapEditorHandle>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<string | null>(null);

  // ── Data ──

  const { data: sectionData } = useSection(selectedSectionId);
  const updateSection = useUpdateSection();

  // Derive numbering. In a full implementation this comes from the outline
  // tree walker. For now we use a placeholder that can be replaced when the
  // outline context is wired up.
  const numbering = ''; // TODO: derive from outline tree

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

  // ── AI operation stubs ──

  const handleAIGenerate = useCallback(() => {
    // TODO: wire to AI generate pipeline
  }, []);

  const handleAIRewrite = useCallback(() => {
    // TODO: wire to AI rewrite pipeline
  }, []);

  const handleAIExpand = useCallback(() => {
    // TODO: wire to AI expand pipeline
  }, []);

  const handleAICancel = useCallback(() => {
    const taskId = useEditorStore.getState().aiGeneratingTaskId;
    if (taskId !== null) {
      // TODO: call pipeline cancel IPC
    }
    useEditorStore.getState().setAIGenerating(false);
  }, []);

  const handleAICompress = useCallback(() => {
    // TODO: wire to AI compress pipeline
  }, []);

  const handleInsertCitation = useCallback(() => {
    // TODO: open citation picker
  }, []);

  const handleInsertMath = useCallback(() => {
    // TODO: open math input
  }, []);

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
  const sectionTitle = '';

  const editor = editorRef.current?.getEditor() ?? null;

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
