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

// ---------------------------------------------------------------------------
// Selection highlight overlay (persistent after browser Selection collapses)
// ---------------------------------------------------------------------------

const OVERLAY_ATTR = 'data-selection-overlay';

function renderSelectionOverlay(snapshot: TextSnapshot): void {
  clearSelectionOverlay();
  for (const segment of snapshot.segments) {
    const pageEl = findPageContainer(segment.pageNumber);
    if (!pageEl) continue;
    const textLayerEl = pageEl.querySelector('.textLayer');
    if (!textLayerEl) continue;
    const containerRect = pageEl.getBoundingClientRect();
    if (containerRect.width === 0 || containerRect.height === 0) continue;

    for (const rect of segment.rects) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const div = document.createElement('div');
      div.setAttribute(OVERLAY_ATTR, '1');
      div.style.position = 'absolute';
      div.style.left = `${((rect.left - containerRect.left) / containerRect.width) * 100}%`;
      div.style.top = `${((rect.top - containerRect.top) / containerRect.height) * 100}%`;
      div.style.width = `${(rect.width / containerRect.width) * 100}%`;
      div.style.height = `${(rect.height / containerRect.height) * 100}%`;
      div.style.backgroundColor = 'rgba(59, 130, 246, 0.25)';
      div.style.borderRadius = '1px';
      div.style.pointerEvents = 'none';
      div.style.zIndex = '5';
      textLayerEl.appendChild(div);
    }
  }
}

function clearSelectionOverlay(): void {
  document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSelectionMachine(
  blockMap: Map<number, ContentBlockDTO[]>,
): SelectionMachineState & { clearSelection: () => void } {
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

      // Compute live per-page bounds for DLA highlight preview
      const tempEnd = currentPoint;
      const boundsMap = new Map<number, ColumnBounds[]>();
      const minP = Math.min(envelope.start.page, tempEnd.page);
      const maxP = Math.max(envelope.start.page, tempEnd.page);
      for (let p = minP; p <= maxP; p++) {
        const bounds = computePageBounds(
          { start: envelope.start, end: tempEnd },
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
    (envelope: DragEnvelope & { end: DragPoint }) => {
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
      const finalBoundsMap = new Map<number, ColumnBounds[]>();

      for (let p = minP; p <= maxP; p++) {
        const bounds = computePageBounds(envelope, p);
        if (bounds.length === 0) continue;
        finalBoundsMap.set(p, bounds);

        const pageContainer = findPageContainer(p);
        // blockMap is 0-based pageIndex
        const pageBlocks = blockMapRef.current.get(p - 1) ?? [];
        const capturableBlocks = pageBlocks.filter((b) =>
          CAPTURABLE_TYPES.has(b.type),
        );

        if (!pageContainer || capturableBlocks.length === 0) continue;

        for (const block of capturableBlocks) {
          if (blockOverlaps(block.bbox, bounds)) {
            const clip = captureBlockRegion(
              pageContainer,
              block.bbox,
              p,
              block.type,
            );
            if (clip) capturedImages.push(clip);
          }
        }
      }

      const payload: SelectionPayload = {
        sourcePages: snapshot.sourcePages,
        ...(snapshot.text ? { text: snapshot.text } : {}),
        ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
      };

      phaseRef.current = 'CAPTURED';

      // Render persistent highlight overlay so the selection stays visible
      // even after the browser Selection collapses (e.g. user clicks chat).
      renderSelectionOverlay(snapshot);

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
    [],
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
