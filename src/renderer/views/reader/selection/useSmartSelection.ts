/**
 * useSmartSelection — DLA-aware text selection hook.
 *
 * Phase 1 (selectionchange, debounced): track selected text + rects (cheap)
 * Phase 2 (mouseup): capture overlapping non-text blocks as images (expensive)
 *
 * Produces a unified SelectionPayload { text, images, sourcePages }.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContentBlockDTO } from '../../../../shared-types/models';
import type {
  SelectionPayload,
  ImageClip,
} from '../../../core/store/useReaderStore';
import { captureBlockRegion } from '../viewport/layers/captureBlockRegion';

/** Block types that should be auto-captured as images */
const CAPTURABLE_TYPES = new Set(['figure', 'table', 'formula']);

interface SmartSelectionState {
  selectedText: string | null;
  anchorPageNumber: number | null;
  selectionRects: DOMRect[] | null;
  capturedImages: ImageClip[];
  payload: SelectionPayload | null;
}

const NULL_STATE: SmartSelectionState = {
  selectedText: null,
  anchorPageNumber: null,
  selectionRects: null,
  capturedImages: [],
  payload: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getPageNumber(node: Node): number | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (el) {
    const attr = el.getAttribute('data-page');
    if (attr !== null) {
      const n = parseInt(attr, 10);
      return Number.isFinite(n) ? n : null;
    }
    el = el.parentElement;
  }
  return null;
}

function isInsideTextLayer(node: Node): boolean {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (el) {
    if (el.classList.contains('textLayer')) return true;
    el = el.parentElement;
  }
  return false;
}

function findPageContainer(pageNumber: number): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-page="${pageNumber}"]`,
  );
  for (const el of candidates) {
    if (el.querySelector('canvas')) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSmartSelection(
  blockMap: Map<number, ContentBlockDTO[]>,
): SmartSelectionState & { clearSelection: () => void } {
  const [state, setState] = useState<SmartSelectionState>(NULL_STATE);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockMapRef = useRef(blockMap);
  blockMapRef.current = blockMap;

  // ---- Phase 1: track selection text + rects (cheap, on selectionchange) ----
  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setState(NULL_STATE);
          return;
        }

        const { anchorNode } = sel;
        if (!anchorNode || !isInsideTextLayer(anchorNode)) {
          setState(NULL_STATE);
          return;
        }

        const text = sel.toString();
        if (!text.trim()) {
          setState(NULL_STATE);
          return;
        }

        const pageNumber = getPageNumber(anchorNode);
        if (pageNumber === null) {
          setState(NULL_STATE);
          return;
        }

        const range = sel.getRangeAt(0);
        const clientRects = range.getClientRects();
        const rects: DOMRect[] = [];
        for (let i = 0; i < clientRects.length; i++) rects.push(clientRects[i]!);
        if (rects.length === 0) {
          setState(NULL_STATE);
          return;
        }

        // Text-only state — images captured later on mouseup
        setState((prev) => ({
          selectedText: text,
          anchorPageNumber: pageNumber,
          selectionRects: rects,
          capturedImages: prev.capturedImages, // keep previous captures
          payload: prev.payload,
        }));
      }, 50);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // ---- Phase 2: capture images on mouseup (expensive, runs once) ----
  useEffect(() => {
    const handleMouseUp = (): void => {
      // Small delay to let selectionchange settle first
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

        const { anchorNode } = sel;
        if (!anchorNode || !isInsideTextLayer(anchorNode)) return;

        const text = sel.toString();
        if (!text.trim()) return;

        const pageNumber = getPageNumber(anchorNode);
        if (pageNumber === null) return;

        const range = sel.getRangeAt(0);
        const clientRects = range.getClientRects();
        const rects: DOMRect[] = [];
        for (let i = 0; i < clientRects.length; i++) rects.push(clientRects[i]!);
        if (rects.length === 0) return;

        // Capture non-text blocks that overlap the selection OR were drag-highlighted
        const capturedImages: ImageClip[] = [];
        const pageContainer = findPageContainer(pageNumber);
        const pageBlocks = blockMapRef.current.get(pageNumber - 1) ?? [];
        const capturableBlocks = pageBlocks.filter((b) =>
          CAPTURABLE_TYPES.has(b.type),
        );

        if (pageContainer && capturableBlocks.length > 0) {
          // Capture blocks that TextLayer marked as drag-highlighted.
          // TextLayer's column-aware logic is the single source of truth
          // for which blocks overlap the selection.
          const highlightedBboxes = new Set<string>();
          const textLayer = pageContainer.querySelector('.textLayer');
          if (textLayer) {
            const highlighted = textLayer.querySelectorAll<HTMLElement>('.dla-drag-highlight');
            for (const el of highlighted) {
              const bboxStr = el.getAttribute('data-bbox');
              if (bboxStr) highlightedBboxes.add(bboxStr);
            }
          }

          for (const block of capturableBlocks) {
            const bboxKey = JSON.stringify(block.bbox);
            if (highlightedBboxes.has(bboxKey)) {
              const clip = captureBlockRegion(
                pageContainer,
                block.bbox,
                pageNumber,
                block.type,
              );
              if (clip) capturedImages.push(clip);
            }
          }
        }

        const payload: SelectionPayload = {
          sourcePages: [pageNumber],
          ...(text.trim() ? { text: text.trim() } : {}),
          ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
        };

        setState({
          selectedText: text,
          anchorPageNumber: pageNumber,
          selectionRects: rects,
          capturedImages,
          payload,
        });
      });
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const clearSelection = useCallback((): void => {
    window.getSelection()?.removeAllRanges();
    setState(NULL_STATE);
  }, []);

  return { ...state, clearSelection };
}
