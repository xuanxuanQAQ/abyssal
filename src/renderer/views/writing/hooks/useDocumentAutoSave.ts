/**
 * useDocumentAutoSave — Auto-save hook for the unified editor.
 *
 * On editor update:
 * 1. Disassemble document into sections
 * 2. Compare each section's content hash against known state
 * 3. Save only changed sections via saveDocumentSections IPC
 * 4. Debounce at 1500ms
 */

import { useCallback, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { disassembleDocument, contentHash } from '../editor/documentAssembler';
import { getAPI } from '../../../core/ipc/bridge';
import { useEditorStore } from '../../../core/store/useEditorStore';

interface UseDocumentAutoSaveOptions {
  editor: Editor | null;
  articleId: string | null;
  debounceMs?: number;
}

export function useDocumentAutoSave({
  editor,
  articleId,
  debounceMs = 1_500,
}: UseDocumentAutoSaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownHashesRef = useRef<Map<string, string>>(new Map());
  const savingRef = useRef(false);

  const flushSave = useCallback(async () => {
    if (!editor || !articleId || savingRef.current) return;
    if (editor.isDestroyed) return;

    const docJson = editor.getJSON() as JSONContent;
    const sections = disassembleDocument(docJson);

    // Find changed sections
    const changedSections: Array<{
      sectionId: string;
      title: string;
      content: string;
      documentJson: string | null;
      source: 'manual' | 'auto';
    }> = [];

    for (const [sectionId, data] of sections) {
      const hash = contentHash({ type: 'doc', content: data.contentNodes });
      const knownHash = knownHashesRef.current.get(sectionId);

      if (knownHash !== hash) {
        changedSections.push({
          sectionId,
          title: data.title,
          content: '', // Will be derived from documentJson on backend
          documentJson: data.documentJson,
          source: 'auto',
        });
        knownHashesRef.current.set(sectionId, hash);
      }
    }

    if (changedSections.length === 0) {
      useEditorStore.getState().setUnsavedChanges(false);
      return;
    }

    savingRef.current = true;
    try {
      await getAPI().db.articles.saveDocumentSections(articleId, changedSections as any);
      useEditorStore.getState().setUnsavedChanges(false);
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, [editor, articleId]);

  const scheduleAutoSave = useCallback(() => {
    useEditorStore.getState().setUnsavedChanges(true);

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushSave();
    }, debounceMs);
  }, [flushSave, debounceMs]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushSave();
    };
  }, [flushSave]);

  /** Reset known hashes when loading a new document */
  const resetHashes = useCallback((sections: Map<string, string>) => {
    knownHashesRef.current = sections;
  }, []);

  return { scheduleAutoSave, flushSave, resetHashes };
}
