/**
 * useSelectionMachine — unified selection state machine.
 *
 * Replaces useSmartSelection with a clean architecture:
 *   • Visual bounds from mouse coordinates (DragEnvelope)
 *   • Text content from Selection API (text extraction + annotation coords)
 *   • DLA block filtering via pure geometry (dragEnvelope.ts)
 *
 * State Machine: IDLE → DRAGGING → CAPTURED → TOOLBAR_VISIBLE → IDLE
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContentBlockDTO } from '../../../../shared-types/models';
import type {
  SelectionPayload,
  ImageClip,
} from '../../../core/store/useReaderStore';
import { captureBlockRegion } from '../viewport/layers/captureBlockRegion';
import {
  type DragEnvelope,
  type DragPoint,
  type ColumnBounds,
  dragPointFromEvent,
  recalibrateDragPoint,
  computePageBounds,
  blockOverlaps,
} from './dragEnvelope';
import {
  isInsideTextLayer,
  findPageNumberFromNode,
  buildTextSnapshot,
  type TextSnapshot,
} from './documentSelection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Block types that should be auto-captured as images */
const CAPTURABLE_TYPES = new Set(['figure', 'table', 'formula']);

type MachinePhase = 'IDLE' | 'DRAGGING' | 'CAPTURED';

export interface SelectionMachineState {
  phase: MachinePhase;
  selectedText: string | null;
  primaryPageNumber: number | null;
  sourcePages: number[];
  textSnapshot: TextSnapshot | null;
  capturedImages: ImageClip[];
  payload: SelectionPayload | null;
  /** Finalized envelope (non-null in CAPTURED phase) for toolbar positioning */
  envelope: DragEnvelope | null;
  /** Per-page visual bounds for DLA highlight during drag */
  dragBoundsMap: Map<number, ColumnBounds[]>;
}

interface SelectionMachineOptions {
  getPage?: (pageNumber: number) => Promise<any>;
  scale?: number;
}

const IDLE_STATE: SelectionMachineState = {
  phase: 'IDLE',
  selectedText: null,
  primaryPageNumber: null,
  sourcePages: [],
  textSnapshot: null,
  capturedImages: [],
  payload: null,
  envelope: null,
  dragBoundsMap: new Map(),
};

// ---------------------------------------------------------------------------
// DOM Helpers
// ---------------------------------------------------------------------------

function findPageSlotElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (el) {
    if (el.hasAttribute('data-page') && el.querySelector('canvas')) {
      return el as HTMLElement;
    }
    el = el.parentElement;
  }
  return null;
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

function boundsFromSelectionRects(
  rects: DOMRect[],
  pageContainer: HTMLElement,
): ColumnBounds[] {
  const pageRect = pageContainer.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0 || rects.length === 0) {
    return [];
  }

  let lTop = 1;
  let lBottom = 0;
  let rTop = 1;
  let rBottom = 0;
  let hasL = false;
  let hasR = false;

  for (const rect of rects) {
    const top = Math.max(0, Math.min(1, (rect.top - pageRect.top) / pageRect.height));
    const bottom = Math.max(0, Math.min(1, (rect.bottom - pageRect.top) / pageRect.height));
    const centerX = (rect.left + rect.right) * 0.5;
    const nx = (centerX - pageRect.left) / pageRect.width;

    if (nx < 0.5) {
      hasL = true;
      lTop = Math.min(lTop, top);
      lBottom = Math.max(lBottom, bottom);
    } else {
      hasR = true;
      rTop = Math.min(rTop, top);
      rBottom = Math.max(rBottom, bottom);
    }
  }

  const bounds: ColumnBounds[] = [];
  if (hasL && lBottom > lTop) bounds.push({ col: 'L', top: lTop, bottom: lBottom });
  if (hasR && rBottom > rTop) bounds.push({ col: 'R', top: rTop, bottom: rBottom });
  return bounds;
}

function expandDegenerateBound(
  original: ColumnBounds,
  fromRects: ColumnBounds[] | null,
): ColumnBounds {
  const match = fromRects?.find((b) => b.col === original.col);
  const edgeBand = 0.28;

  // Degenerated near bottom edge
  if (original.top >= 0.99 && original.bottom >= 0.99) {
    const rectTop = match?.top ?? 1;
    return {
      col: original.col,
      top: Math.max(1 - edgeBand, rectTop),
      bottom: 1,
    };
  }

  // Degenerated near top edge
  if (original.top <= 0.01 && original.bottom <= 0.01) {
    const rectBottom = match?.bottom ?? 0;
    return {
      col: original.col,
      top: 0,
      bottom: Math.min(edgeBand, rectBottom > 0 ? rectBottom : edgeBand),
    };
  }

  // Generic degenerated case: create a narrow local band around center.
  const center = (original.top + original.bottom) * 0.5;
  return {
    col: original.col,
    top: Math.max(0, center - edgeBand / 2),
    bottom: Math.min(1, center + edgeBand / 2),
  };
}

function mergeBoundsByColumn(bounds: ColumnBounds[]): ColumnBounds[] {
  const merged = new Map<ColumnBounds['col'], ColumnBounds>();
  for (const b of bounds) {
    if (b.bottom <= b.top) continue;
    const existing = merged.get(b.col);
    if (!existing) {
      merged.set(b.col, { ...b });
      continue;
    }
    merged.set(b.col, {
      col: b.col,
      top: Math.min(existing.top, b.top),
      bottom: Math.max(existing.bottom, b.bottom),
    });
  }

  const ordered: ColumnBounds[] = [];
  const full = merged.get('full');
  if (full) ordered.push(full);
  const left = merged.get('L');
  if (left) ordered.push(left);
  const right = merged.get('R');
  if (right) ordered.push(right);
  return ordered;
}

function reconcileBoundsWithSelectionRects(
  computed: ColumnBounds[],
  fromRects: ColumnBounds[],
): ColumnBounds[] {
  if (fromRects.length === 0) return computed;

  const reconciled: ColumnBounds[] = [];
  for (const b of computed) {
    if (b.col === 'full') {
      reconciled.push(...fromRects);
      continue;
    }

    const m = fromRects.find((r) => r.col === b.col);
    if (!m) {
      reconciled.push(b);
      continue;
    }

    const top = Math.max(b.top, m.top);
    const bottom = Math.min(b.bottom, m.bottom);
    if (bottom - top > 0.01) {
      reconciled.push({ col: b.col, top, bottom });
    } else {
      reconciled.push(b);
    }
  }

  const merged = mergeBoundsByColumn(reconciled);
  return merged.length > 0 ? merged : computed;
}

function createImageClipKey(clip: ImageClip): string {
  return [
    clip.pageNumber,
    clip.type,
    clip.bbox.x.toFixed(3),
    clip.bbox.y.toFixed(3),
    clip.bbox.w.toFixed(3),
    clip.bbox.h.toFixed(3),
  ].join('|');
}

function selectionDebugLog(message: string): void {
  if (typeof window !== 'undefined' && (window as any).__SELECTION_DEBUG__ === true) {
    // eslint-disable-next-line no-console
    console.log(message);
  }
}

// ---------------------------------------------------------------------------
// Selection highlight behavior
// ---------------------------------------------------------------------------

function clearSelectionOverlay(): void {
  // No-op: custom persistent overlay removed.
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSelectionMachine(
  blockMap: Map<number, ContentBlockDTO[]>,
  options: SelectionMachineOptions = {},
): SelectionMachineState & { clearSelection: () => void } {
  const { getPage, scale = 1 } = options;
  const [state, setState] = useState<SelectionMachineState>(IDLE_STATE);
  const blockMapRef = useRef(blockMap);
  blockMapRef.current = blockMap;

  // Mutable refs for the drag envelope (updated on every mousemove, not in React state)
  const envelopeRef = useRef<DragEnvelope | null>(null);
  const phaseRef = useRef<MachinePhase>('IDLE');
  // Track last clientX/Y for scroll compensation
  const lastClientRef = useRef<{ x: number; y: number } | null>(null);

  // ---- mousedown: IDLE → DRAGGING ----
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      // Don't start selection if clicking a DLA blocker
      if (target.hasAttribute('data-dla-blocker')) return;
      // Must be inside a textLayer
      if (!isInsideTextLayer(target)) return;

      const pageEl = findPageSlotElement(target);
      if (!pageEl) return;
      const pageAttr = pageEl.getAttribute('data-page');
      if (!pageAttr) return;
      const pageNumber = parseInt(pageAttr, 10);
      if (!Number.isFinite(pageNumber)) return;

      const startPoint = dragPointFromEvent(e, pageEl, pageNumber);
      const envelope: DragEnvelope = {
        start: startPoint,
        current: startPoint,
        end: null,
      };
      envelopeRef.current = envelope;
      phaseRef.current = 'DRAGGING';
      lastClientRef.current = { x: e.clientX, y: e.clientY };

      setState((prev) => ({
        ...prev,
        phase: 'DRAGGING',
        dragBoundsMap: new Map(),
      }));
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // ---- mousemove: update current point + live DLA bounds ----
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (phaseRef.current !== 'DRAGGING') return;
      const envelope = envelopeRef.current;
      if (!envelope) return;

      lastClientRef.current = { x: e.clientX, y: e.clientY };

      // Determine which page the mouse is currently over
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pageEl = findPageSlotElement(el);
      if (!pageEl) return;
      const pageAttr = pageEl.getAttribute('data-page');
      if (!pageAttr) return;
      const pageNumber = parseInt(pageAttr, 10);
      if (!Number.isFinite(pageNumber)) return;

      const currentPoint = dragPointFromEvent(e, pageEl, pageNumber);
      envelope.current = currentPoint;

      // Scroll compensation: recalibrate start point during drag so the
      // visual bounds stay accurate when the user scrolls mid-drag.
      const startPageEl = findPageContainer(envelope.start.page);
      const calibratedStart = startPageEl
        ? recalibrateDragPoint(envelope.start, startPageEl)
        : envelope.start;

      // Compute live per-page bounds for DLA highlight preview
      const tempEnd = currentPoint;
      const boundsMap = new Map<number, ColumnBounds[]>();
      const minP = Math.min(calibratedStart.page, tempEnd.page);
      const maxP = Math.max(calibratedStart.page, tempEnd.page);
      for (let p = minP; p <= maxP; p++) {
        const bounds = computePageBounds(
          { start: calibratedStart, end: tempEnd },
          p,
        );
        if (bounds.length > 0) boundsMap.set(p, bounds);
      }

      setState((prev) => {
        if (prev.phase !== 'DRAGGING') return prev;
        return { ...prev, dragBoundsMap: boundsMap };
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    return () => document.removeEventListener('mousemove', onMouseMove);
  }, []);

  // ---- mouseup: DRAGGING → CAPTURED ----
  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (phaseRef.current !== 'DRAGGING') return;
      const envelope = envelopeRef.current;
      if (!envelope) return;

      // Determine end page
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pageEl = findPageSlotElement(el);

      let endPoint: DragPoint;
      if (pageEl) {
        const pageAttr = pageEl.getAttribute('data-page');
        const pageNumber = pageAttr ? parseInt(pageAttr, 10) : envelope.current.page;
        endPoint = dragPointFromEvent(
          e,
          pageEl,
          Number.isFinite(pageNumber) ? pageNumber : envelope.current.page,
        );
      } else {
        endPoint = {
          ...envelope.current,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      }

      // ---- Scroll compensation: recalibrate start point ----
      // During drag, user may have scrolled. The start point's clientX/Y
      // were recorded at mousedown time and are now stale relative to the
      // page rect. Recompute normalized coords using fresh page rect.
      const startPageEl = findPageContainer(envelope.start.page);
      const calibratedStart = startPageEl
        ? recalibrateDragPoint(envelope.start, startPageEl)
        : envelope.start;

      // Similarly recalibrate end point with its page element
      const endPageEl = pageEl ?? findPageContainer(endPoint.page);
      const calibratedEnd = endPageEl
        ? recalibrateDragPoint(endPoint, endPageEl)
        : endPoint;

      envelope.start = calibratedStart;
      envelope.end = calibratedEnd;
      envelope.current = calibratedEnd;

      // Schedule capture in rAF so Selection API has settled
      requestAnimationFrame(() => {
        completeCapturePhase(envelope as DragEnvelope & { end: DragPoint });
      });
    };

    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // ---- Capture phase: read Selection API + capture DLA images ----
  const completeCapturePhase = useCallback(
    async (envelope: DragEnvelope & { end: DragPoint }) => {
      const sel = window.getSelection();
      const snapshot = buildTextSnapshot(sel);

      if (!snapshot) {
        // No text selected — return to IDLE
        clearSelectionOverlay();
        phaseRef.current = 'IDLE';
        envelopeRef.current = null;
        setState(IDLE_STATE);
        return;
      }

      // Compute per-page bounds from the finalized envelope
      const minP = Math.min(envelope.start.page, envelope.end.page);
      const maxP = Math.max(envelope.start.page, envelope.end.page);

      const capturedImages: ImageClip[] = [];
      const capturedImageKeys = new Set<string>();
      const finalBoundsMap = new Map<number, ColumnBounds[]>();
      const offscreenPageCanvasCache = new Map<number, HTMLCanvasElement>();

      selectionDebugLog(
        `[SelectionCapture] START pages=${minP}-${maxP} sourcePages=[${snapshot.sourcePages.join(',')}] textLen=${snapshot.text.length}`,
      );

      const pagesToProcess = new Set<number>();
      for (let p = minP; p <= maxP; p++) pagesToProcess.add(p);
      for (const p of snapshot.sourcePages) pagesToProcess.add(p);
      const sortedPages = Array.from(pagesToProcess).sort((a, b) => a - b);

      const captureBlockRegionOffscreen = async (
        pageNumber: number,
        bbox: { x: number; y: number; w: number; h: number },
        blockType: string,
      ): Promise<ImageClip | null> => {
        if (!getPage) {
          selectionDebugLog(
            `[SelectionCapture] OFFSCREEN_SKIP page=${pageNumber} type=${blockType} reason=no_getPage`,
          );
          return null;
        }

        try {
          let canvas = offscreenPageCanvasCache.get(pageNumber);
          if (!canvas) {
            const page = await getPage(pageNumber);
            const viewport = page.getViewport({ scale });
            const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
            canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
            canvas.height = Math.max(1, Math.floor(viewport.height * dpr));

            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.scale(dpr, dpr);

            const renderTask = page.render({
              canvas,
              canvasContext: ctx,
              viewport,
            });
            await renderTask.promise;
            offscreenPageCanvasCache.set(pageNumber, canvas);
          }

          const sw = canvas.width;
          const sh = canvas.height;
          const sx = Math.round(bbox.x * sw);
          const sy = Math.round(bbox.y * sh);
          const sWidth = Math.round(bbox.w * sw);
          const sHeight = Math.round(bbox.h * sh);
          if (sWidth < 2 || sHeight < 2) {
            selectionDebugLog(
              `[SelectionCapture] OFFSCREEN_FAIL page=${pageNumber} type=${blockType} reason=small_crop size=${sWidth}x${sHeight}`,
            );
            return null;
          }

          const offscreen = document.createElement('canvas');
          offscreen.width = sWidth;
          offscreen.height = sHeight;
          const offCtx = offscreen.getContext('2d');
          if (!offCtx) return null;
          offCtx.drawImage(canvas, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

          const clip = {
            type: blockType,
            dataUrl: offscreen.toDataURL('image/jpeg', 0.85),
            pageNumber,
            bbox,
          };
          selectionDebugLog(
            `[SelectionCapture] OFFSCREEN_OK page=${pageNumber} type=${blockType} size=${sWidth}x${sHeight}`,
          );
          return clip;
        } catch {
          selectionDebugLog(
            `[SelectionCapture] OFFSCREEN_FAIL page=${pageNumber} type=${blockType} reason=render_exception`,
          );
          return null;
        }
      };

      for (const p of sortedPages) {
        const inEnvelope = p >= minP && p <= maxP;
        let bounds = inEnvelope ? computePageBounds(envelope, p) : [];
        const snapshotSegment = snapshot.segments.find((s) => s.pageNumber === p);
        const pageContainer = findPageContainer(p);

        if (snapshotSegment && pageContainer) {
          const fromRects = boundsFromSelectionRects(snapshotSegment.rects, pageContainer);
          if (bounds.length === 0 && fromRects.length > 0) {
            bounds = fromRects;
            selectionDebugLog(
              `[SelectionCapture] BOUNDS_FROM_RECTS page=${p} bounds=${fromRects.map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`).join('|')}`,
            );
          } else if (bounds.length > 0 && fromRects.length > 0) {
            const oldSummary = bounds
              .map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`)
              .join('|');
            bounds = reconcileBoundsWithSelectionRects(bounds, fromRects);
            const reconciledSummary = bounds
              .map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`)
              .join('|');
            if (oldSummary !== reconciledSummary) {
              selectionDebugLog(
                `[SelectionCapture] BOUNDS_RECONCILED page=${p} old=${oldSummary} new=${reconciledSummary}`,
              );
            }
          }

          const hasDegenerateBounds = bounds.some((b) => b.bottom - b.top < 0.01);
          if (hasDegenerateBounds) {
            const oldSummary = bounds
              .map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`)
              .join('|');
            bounds = bounds.map((b) =>
              b.bottom - b.top < 0.01
                ? expandDegenerateBound(b, fromRects.length > 0 ? fromRects : null)
                : b,
            );
            const newSummary = bounds
              .map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`)
              .join('|');
            selectionDebugLog(
              `[SelectionCapture] BOUNDS_EXPANDED page=${p} old=${oldSummary} new=${newSummary}`,
            );
          }
        }

        if (bounds.length === 0) continue;

        finalBoundsMap.set(p, bounds);

        // blockMap is 0-based pageIndex
        const pageBlocks = blockMapRef.current.get(p - 1) ?? [];
        const capturableBlocks = pageBlocks.filter((b) =>
          CAPTURABLE_TYPES.has(b.type),
        );
        const boundsSummary = bounds
          .map((b) => `${b.col}:${b.top.toFixed(3)}-${b.bottom.toFixed(3)}`)
          .join('|');

        selectionDebugLog(
          `[SelectionCapture] PAGE page=${p} hasContainer=${Boolean(pageContainer)} blocks=${pageBlocks.length} capturable=${capturableBlocks.length} bounds=${boundsSummary}`,
        );

        if (capturableBlocks.length === 0) continue;

        let pageCaptured = 0;
        for (const block of capturableBlocks) {
          if (blockOverlaps(block.bbox, bounds)) {
            let clip = pageContainer
              ? captureBlockRegion(
                  pageContainer,
                  block.bbox,
                  p,
                  block.type,
                )
              : null;

            if (clip) {
              selectionDebugLog(
                `[SelectionCapture] CANVAS_OK page=${p} type=${block.type} bbox=${block.bbox.x.toFixed(3)},${block.bbox.y.toFixed(3)},${block.bbox.w.toFixed(3)},${block.bbox.h.toFixed(3)}`,
              );
            }

            if (!clip) {
              selectionDebugLog(
                `[SelectionCapture] CANVAS_MISS page=${p} type=${block.type} hasContainer=${Boolean(pageContainer)} -> try_offscreen`,
              );
              clip = await captureBlockRegionOffscreen(p, block.bbox, block.type);
            }

            if (clip) {
              const key = createImageClipKey(clip);
              if (!capturedImageKeys.has(key)) {
                capturedImageKeys.add(key);
                capturedImages.push(clip);
                pageCaptured += 1;
              } else {
                selectionDebugLog(
                  `[SelectionCapture] DUPLICATE_SKIP page=${p} type=${block.type}`,
                );
              }
            }
          } else {
            selectionDebugLog(
              `[SelectionCapture] BLOCK_SKIP page=${p} type=${block.type} reason=no_overlap`,
            );
          }
        }

        selectionDebugLog(
          `[SelectionCapture] PAGE_DONE page=${p} captured=${pageCaptured}`,
        );
      }

      selectionDebugLog(
        `[SelectionCapture] DONE capturedImages=${capturedImages.length}`,
      );

      const payload: SelectionPayload = {
        sourcePages: snapshot.sourcePages,
        ...(snapshot.text ? { text: snapshot.text } : {}),
        ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
      };
      phaseRef.current = 'CAPTURED';

      // Keep only native browser selection highlight.

      setState({
        phase: 'CAPTURED',
        selectedText: snapshot.text,
        primaryPageNumber: snapshot.sourcePages[0] ?? null,
        sourcePages: snapshot.sourcePages,
        textSnapshot: snapshot,
        capturedImages,
        payload,
        envelope,
        dragBoundsMap: finalBoundsMap,
      });
    },
    [getPage, scale],
  );

  // ---- mousedown in textLayer while CAPTURED → reset to new drag ----
  // Clicking outside (e.g. chat dialog) does NOT dismiss the selection,
  // so the quoted text and captured images persist in the store.
  // Only a new mousedown inside a textLayer resets to IDLE/DRAGGING.
  // The clearSelection() callback is also available for explicit dismissal
  // (e.g. toolbar cancel button).
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (phaseRef.current !== 'CAPTURED') return;

      const target = e.target as HTMLElement;
      if (!isInsideTextLayer(target)) return;

      // User started a new selection inside the PDF → reset
      clearSelectionOverlay();
      phaseRef.current = 'IDLE';
      envelopeRef.current = null;
      setState(IDLE_STATE);
    };

    document.addEventListener('mousedown', onMouseDown, true);
    return () =>
      document.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  // ---- clearSelection: manual dismiss ----
  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    clearSelectionOverlay();
    phaseRef.current = 'IDLE';
    envelopeRef.current = null;
    setState(IDLE_STATE);
  }, []);

  return { ...state, clearSelection };
}
