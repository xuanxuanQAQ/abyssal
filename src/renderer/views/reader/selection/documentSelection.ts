/**
 * documentSelection — Selection API utilities.
 *
 * This module handles ONLY text extraction and per-span DOMRect bucketing
 * for annotation coordinate conversion. It does NOT compute visual bounds
 * for DLA block filtering (that's handled by dragEnvelope.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageSelectionSegment {
  pageNumber: number;
  rects: DOMRect[];
}

/** Text snapshot from Selection API — used for annotation coords + text */
export interface TextSnapshot {
  text: string;
  sourcePages: number[];
  segments: PageSelectionSegment[];
}

/**
 * Legacy snapshot shape — kept for backward compat with selectionToAnnotation
 * and the auto-apply annotation flow in PDFViewport.
 */
export interface DocumentSelectionSnapshot {
  selectedText: string;
  sourcePages: number[];
  primaryPageNumber: number;
  segments: PageSelectionSegment[];
  selectionRects: DOMRect[];
  anchorRect: DOMRect;
}

// ---------------------------------------------------------------------------
// DOM helpers (exported for reuse in useSelectionMachine)
// ---------------------------------------------------------------------------

export function findPageNumberFromNode(node: Node | null): number | null {
  if (!node) return null;

  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  while (el) {
    const pageAttr = el.getAttribute('data-page');
    if (pageAttr !== null) {
      const parsed = parseInt(pageAttr, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    el = el.parentElement;
  }

  return null;
}

export function isInsideTextLayer(node: Node | null): boolean {
  if (!node) return false;

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findPageFromElement(el: Element | null): number | null {
  let cur: Element | null = el;
  while (cur) {
    const pageAttr = cur.getAttribute('data-page');
    if (pageAttr !== null) {
      const parsed = parseInt(pageAttr, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    cur = cur.parentElement;
  }
  return null;
}

interface PageSlotRect {
  pageNumber: number;
  rect: DOMRect;
}

function collectPageSlotRects(): PageSlotRect[] {
  const pageMap = new Map<number, DOMRect>();
  const candidates = document.querySelectorAll<HTMLElement>('[data-page]');

  for (const el of candidates) {
    if (!el.querySelector('canvas')) continue;
    const pageAttr = el.getAttribute('data-page');
    if (pageAttr === null) continue;
    const pageNumber = parseInt(pageAttr, 10);
    if (!Number.isFinite(pageNumber)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    pageMap.set(pageNumber, rect);
  }

  return Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, rect]) => ({ pageNumber, rect }));
}

function pageNumberFromRect(
  rect: DOMRect,
  pageSlots: PageSlotRect[],
): number | null {
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;

  for (const slot of pageSlots) {
    if (
      centerX >= slot.rect.left &&
      centerX <= slot.rect.right &&
      centerY >= slot.rect.top &&
      centerY <= slot.rect.bottom
    ) {
      return slot.pageNumber;
    }
  }

  let bestPage: number | null = null;
  let bestOverlap = 0;
  for (const slot of pageSlots) {
    const overlap =
      Math.max(0, Math.min(rect.bottom, slot.rect.bottom) - Math.max(rect.top, slot.rect.top));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestPage = slot.pageNumber;
    }
  }
  if (bestPage !== null) return bestPage;

  const probePoints: Array<{ x: number; y: number }> = [
    { x: centerX, y: centerY },
    { x: rect.left + 1, y: rect.top + 1 },
    { x: rect.right - 1, y: rect.bottom - 1 },
  ];

  for (const point of probePoints) {
    const el = document.elementFromPoint(point.x, point.y);
    const page = findPageFromElement(el);
    if (page !== null) return page;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bucketing: assign per-span DOMRects to pages
// ---------------------------------------------------------------------------

function bucketRects(
  rects: DOMRect[],
  startPage: number | null,
  endPage: number | null,
  fallbackPage: number | null,
): Map<number, DOMRect[]> {
  const buckets = new Map<number, DOMRect[]>();

  // Fast path: single-page selection
  if (startPage !== null && endPage !== null && startPage === endPage) {
    buckets.set(startPage, rects);
    return buckets;
  }

  const pageSlots = collectPageSlotRects();

  for (const rect of rects) {
    const pageNumber = pageNumberFromRect(rect, pageSlots) ?? fallbackPage;
    if (pageNumber === null) continue;

    const group = buckets.get(pageNumber);
    if (group) {
      group.push(rect);
    } else {
      buckets.set(pageNumber, [rect]);
    }
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Public: buildTextSnapshot (new, for useSelectionMachine)
// ---------------------------------------------------------------------------

/**
 * Build a lightweight text snapshot from the current browser Selection.
 * Returns text + per-page DOMRect segments (for annotation coordinate conversion).
 * Does NOT compute bounds for DLA filtering.
 */
export function buildTextSnapshot(
  selection: Selection | null,
): TextSnapshot | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = selection.toString().trim();
  if (!text) return null;

  if (!isInsideTextLayer(selection.anchorNode)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const clientRects = range.getClientRects();
  if (clientRects.length === 0) return null;

  const rects: DOMRect[] = [];
  for (let i = 0; i < clientRects.length; i++) {
    rects.push(clientRects[i]!);
  }

  const startPage = findPageNumberFromNode(range.startContainer);
  const endPage = findPageNumberFromNode(range.endContainer);
  const anchorPage = findPageNumberFromNode(selection.anchorNode);
  const fallbackPage = startPage ?? endPage ?? anchorPage;

  const buckets = bucketRects(rects, startPage, endPage, fallbackPage);
  if (buckets.size === 0) return null;

  const segments: PageSelectionSegment[] = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, pageRects]) => ({ pageNumber, rects: pageRects }));

  const sourcePages = segments.map((s) => s.pageNumber);

  return { text, sourcePages, segments };
}

// ---------------------------------------------------------------------------
// Public: buildDocumentSelectionSnapshot (legacy, for auto-apply annotation)
// ---------------------------------------------------------------------------

/**
 * Build a full document selection snapshot. Used by PDFViewport's auto-apply
 * annotation flow (textHighlight/textNote/textConceptTag tools).
 */
export function buildDocumentSelectionSnapshot(
  selection: Selection | null,
): DocumentSelectionSnapshot | null {
  const snapshot = buildTextSnapshot(selection);
  if (!snapshot) return null;

  const allRects = snapshot.segments.flatMap((s) => s.rects);
  const anchorRect = snapshot.segments[0]!.rects[0]!;
  const primaryPageNumber = snapshot.sourcePages[0]!;

  return {
    selectedText: snapshot.text,
    sourcePages: snapshot.sourcePages,
    primaryPageNumber,
    segments: snapshot.segments,
    selectionRects: allRects,
    anchorRect,
  };
}
