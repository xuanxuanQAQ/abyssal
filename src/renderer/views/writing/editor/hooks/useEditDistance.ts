/**
 * useEditDistance -- Levenshtein edit distance for ParagraphMark auto-inference (section 5.5)
 *
 * - Records original AI text when AI generates content
 * - Debounced 2000ms after edit
 * - When distance / originalLength > 0.3, clears AI mark
 */

import { useCallback, useRef, useEffect } from 'react';

// ── Levenshtein distance (single-row DP, O(min(m,n)) space) ──

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Ensure we iterate over the longer string in the outer loop
  // and keep the shorter one in the inner loop for space efficiency.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

// ── Types ──

/** Threshold ratio: when editDistance / originalLength exceeds this, clear mark */
const EDIT_THRESHOLD = 0.3;
const DEBOUNCE_MS = 2000;

interface TrackedParagraph {
  pos: number;
  originalText: string;
}

interface UseEditDistanceOptions {
  onMarkCleared: (paragraphPos: number) => void;
}

interface UseEditDistanceReturn {
  /** Record the original AI-generated text for a paragraph at `pos`. */
  trackAIParagraph: (pos: number, originalText: string) => void;
  /** Check the current text against the original; debounced 2000ms. */
  checkEdits: (pos: number, currentText: string) => void;
  /** Stop tracking a paragraph (e.g. when it is deleted). */
  untrack: (pos: number) => void;
}

export function useEditDistance({ onMarkCleared }: UseEditDistanceOptions): UseEditDistanceReturn {
  // Map of paragraph position -> original AI text
  const trackedRef = useRef<Map<number, TrackedParagraph>>(new Map());
  // Map of paragraph position -> debounce timer
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const onMarkClearedRef = useRef(onMarkCleared);
  onMarkClearedRef.current = onMarkCleared;

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const trackAIParagraph = useCallback((pos: number, originalText: string) => {
    trackedRef.current.set(pos, { pos, originalText });
  }, []);

  const checkEdits = useCallback((pos: number, currentText: string) => {
    const tracked = trackedRef.current.get(pos);
    if (tracked === undefined) return;

    // Cancel any existing debounce timer for this paragraph
    const existingTimer = timersRef.current.get(pos);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      timersRef.current.delete(pos);

      const entry = trackedRef.current.get(pos);
      if (entry === undefined) return;

      const distance = levenshteinDistance(entry.originalText, currentText);
      const originalLength = entry.originalText.length;

      // Avoid division by zero
      if (originalLength === 0) return;

      if (distance / originalLength > EDIT_THRESHOLD) {
        // User has edited enough to clear the AI mark
        trackedRef.current.delete(pos);
        onMarkClearedRef.current(pos);
      }
    }, DEBOUNCE_MS);

    timersRef.current.set(pos, timer);
  }, []);

  const untrack = useCallback((pos: number) => {
    trackedRef.current.delete(pos);
    const timer = timersRef.current.get(pos);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(pos);
    }
  }, []);

  return { trackAIParagraph, checkEdits, untrack };
}
