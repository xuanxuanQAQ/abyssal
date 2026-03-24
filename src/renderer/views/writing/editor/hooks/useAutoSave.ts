/**
 * useAutoSave -- Debounced auto-save with content hash dedup (section 6)
 *
 * - Debounce 1500ms after user input
 * - FNV-1a hash of serialized Markdown for dedup (skip save if hash unchanged)
 * - Mod+S triggers immediate save (bypass debounce)
 * - Saves via useUpdateSection mutation
 * - Extracts citedPaperIds by scanning for `[@paper_id]` pattern
 * - Updates unsavedChanges in useEditorStore
 */

import { useCallback, useRef, useEffect } from 'react';
import { useUpdateSection } from '../../../../core/ipc/hooks/useArticles';
import { useEditorStore } from '../../../../core/store/useEditorStore';
import { countWords } from './useWordCount';
import { extractCitedPaperIds } from '../../shared/citationPattern';

// ── FNV-1a hash ──

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

// ── Types ──

interface AutoSaveOptions {
  sectionId: string | null;
  getMarkdown: () => string;
}

interface AutoSaveReturn {
  /** Debounced save -- call on every editor update */
  save: () => void;
  /** Immediate save -- bypasses debounce (Mod+S) */
  saveImmediate: () => void;
}

const DEBOUNCE_MS = 1500;

export function useAutoSave({ sectionId, getMarkdown }: AutoSaveOptions): AutoSaveReturn {
  const { mutateAsync } = useUpdateSection();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedHashRef = useRef<number | null>(null);
  const sectionIdRef = useRef(sectionId);

  // Keep sectionId ref in sync for use inside callbacks
  sectionIdRef.current = sectionId;

  // Clear timer when sectionId changes (new section loaded)
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastSavedHashRef.current = null;
  }, [sectionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const doSave = useCallback(async () => {
    const currentSectionId = sectionIdRef.current;
    if (currentSectionId === null) return;

    const markdown = getMarkdown();
    const hash = fnv1aHash(markdown);

    // Dedup: skip if content hash is unchanged
    if (hash === lastSavedHashRef.current) return;

    const citedPaperIds = extractCitedPaperIds(markdown);
    const wordCount = countWords(markdown);

    try {
      await mutateAsync({
        sectionId: currentSectionId,
        patch: {
          content: markdown,
          wordCount,
          citedPaperIds,
        },
      });

      lastSavedHashRef.current = hash;
      useEditorStore.getState().setUnsavedChanges(false);
    } catch {
      // Mutation onError handler in useUpdateSection already calls handleError.
      // unsavedChanges remains true so the user knows.
    }
  }, [getMarkdown, mutateAsync]);

  const save = useCallback(() => {
    // Mark dirty immediately
    useEditorStore.getState().setUnsavedChanges(true);

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, DEBOUNCE_MS);
  }, [doSave]);

  const saveImmediate = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void doSave();
  }, [doSave]);

  // Register Mod+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveImmediate();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [saveImmediate]);

  return { save, saveImmediate };
}
