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
import { useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { contentHash } from '../../../../shared/writing/documentOutline';
import { getAPI } from '../../../core/ipc/bridge';
import { useEditorStore } from '../../../core/store/useEditorStore';

interface UseDocumentAutoSaveOptions {
  editor: Editor | null;
  draftId: string | null;
  debounceMs?: number;
}

export function useDocumentAutoSave({
  editor,
  draftId,
  debounceMs = 1_500,
}: UseDocumentAutoSaveOptions) {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownHashRef = useRef<string>('');
  const savingRef = useRef(false);
  /** Snapshot of the latest doc JSON — updated on every scheduleAutoSave so
   *  we can still persist even after the editor is destroyed during unmount. */
  const latestDocJsonRef = useRef<JSONContent | null>(null);

  const flushSave = useCallback(async () => {
    if (!draftId || savingRef.current) return;

    // Prefer live editor state; fall back to the snapshot taken at schedule time.
    let docJson: JSONContent | null = null;
    if (editor && !editor.isDestroyed) {
      docJson = editor.getJSON() as JSONContent;
    } else {
      docJson = latestDocJsonRef.current;
    }

    if (!docJson) return;
    const nextHash = contentHash(docJson);
    if (knownHashRef.current === nextHash) {
      useEditorStore.getState().setUnsavedChanges(false);
      return;
    }

    const serialized = JSON.stringify(docJson);

    savingRef.current = true;
    try {
      await getAPI().db.drafts.saveDocument(draftId, serialized, 'auto');
      knownHashRef.current = nextHash;
      latestDocJsonRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ['drafts', 'outline', draftId] });
      void queryClient.invalidateQueries({ queryKey: ['drafts', 'versions', draftId] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      useEditorStore.getState().setUnsavedChanges(false);
    } catch (err) {
      console.error('Auto-save failed:', err);
      useEditorStore.getState().setUnsavedChanges(true);
    } finally {
      savingRef.current = false;
    }
  }, [editor, draftId, queryClient]);

  const scheduleAutoSave = useCallback(() => {
    useEditorStore.getState().setUnsavedChanges(true);

    // Snapshot while the editor is still alive so flushSave can use it on unmount.
    if (editor && !editor.isDestroyed) {
      latestDocJsonRef.current = editor.getJSON() as JSONContent;
    }

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushSave();
    }, debounceMs);
  }, [editor, flushSave, debounceMs]);

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

  /** Reset known hash when loading a new document */
  const resetHashes = useCallback((documentJson: string | null) => {
    latestDocJsonRef.current = null;
    if (!documentJson) {
      knownHashRef.current = '';
      return;
    }

    try {
      knownHashRef.current = contentHash(JSON.parse(documentJson) as JSONContent);
    } catch {
      knownHashRef.current = '';
    }
  }, []);

  return { scheduleAutoSave, flushSave, resetHashes };
}
