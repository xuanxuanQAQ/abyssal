/**
 * dragEnvelope — pure functions for mouse-coordinate-based visual bounds.
 *
 * Converts raw mouse DragEnvelope into per-page PageVisualBounds,
 * then tests DLA block overlap via pure math. Zero DOM dependency.
 *
 * Coordinate system: all values are normalized [0, 1] relative to page
 * dimensions. DLA ContentBlockDTO.bbox already uses this system.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DragPoint {
  /** 1-based page number */
  page: number;
  /** Page-normalized x [0, 1] */
  nx: number;
  /** Page-normalized y [0, 1] */
  ny: number;
  /** Viewport-relative x (for toolbar positioning) */
  clientX: number;
  /** Viewport-relative y (for toolbar positioning) */
  clientY: number;
}

export interface DragEnvelope {
  start: DragPoint;
  current: DragPoint;
  end: DragPoint | null;
}

/** Visual bounds for one column-slice on a single page. */
export interface ColumnBounds {
  col: 'L' | 'R' | 'full';
  top: number;     // [0, 1]
  bottom: number;  // [0, 1]
}

/** Normalized bbox from ContentBlockDTO */
export interface NormalizedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Column boundary — nx < this → left column, otherwise right */
const COL_MID = 0.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colFromNx(nx: number): 'L' | 'R' {
  return nx < COL_MID ? 'L' : 'R';
}

/**
 * Normalize an envelope so `first` is always the physically earlier point
 * (smaller page, or same page with smaller ny). Handles reverse dragging.
 */
export function normalizeEndpoints(
  start: DragPoint,
  end: DragPoint,
): { first: DragPoint; last: DragPoint } {
  const forward =
    start.page < end.page ||
    (start.page === end.page && start.ny <= end.ny);
  return forward ? { first: start, last: end } : { first: end, last: start };
}

// ---------------------------------------------------------------------------
// Core: computePageBounds
// ---------------------------------------------------------------------------

/**
 * Compute the visual bounds for a given page from a finalized DragEnvelope.
 *
 * Returns an array of ColumnBounds (usually 1; 2 when same-page cross-column).
 * Returns empty array if the page is outside the envelope range.
 */
export function computePageBounds(
  envelope: Pick<DragEnvelope, 'start'> & { end: DragPoint },
  page: number,
): ColumnBounds[] {
  const { first, last } = normalizeEndpoints(envelope.start, envelope.end);

  if (page < first.page || page > last.page) return [];

  const isStartPage = page === first.page;
  const isEndPage = page === last.page;

  // ---- Same page ----
  if (isStartPage && isEndPage) {
    const top = Math.min(first.ny, last.ny);
    const bottom = Math.max(first.ny, last.ny);
    const startCol = colFromNx(first.nx);
    const endCol = colFromNx(last.nx);

    if (startCol === endCol) {
      // Same column
      return [{ col: startCol, top, bottom }];
    }

    // Cross-column on same page:
    // "first" has smaller ny (earlier vertically). Determine which is L/R by nx.
    const leftPt = first.nx < last.nx ? first : last;
    const rightPt = first.nx < last.nx ? last : first;

    // Left column: from leftPt.ny down to page bottom
    // Right column: from page top down to rightPt.ny
    // Ensure top < bottom by using min/max with the normalized ny values.
    const lTop = Math.min(leftPt.ny, 1.0);
    const rBottom = Math.max(rightPt.ny, 0.0);

    return [
      { col: 'L', top: lTop, bottom: 1.0 },
      { col: 'R', top: 0.0, bottom: rBottom },
    ];
  }

  // ---- Start page (multi-page) ----
  if (isStartPage) {
    const startCol = colFromNx(first.nx);
    // Two-column reading order (L -> R): if starting in left column,
    // the remainder of the start page includes left tail + full right column.
    if (startCol === 'L') {
      return [
        { col: 'L', top: first.ny, bottom: 1.0 },
        { col: 'R', top: 0.0, bottom: 1.0 },
      ];
    }
    return [{ col: 'R', top: first.ny, bottom: 1.0 }];
  }

  // ---- End page (multi-page) ----
  if (isEndPage) {
    const endCol = colFromNx(last.nx);
    // Two-column reading order (L -> R): if ending in right column,
    // selection includes full left column + right head until end point.
    if (endCol === 'R') {
      return [
        { col: 'L', top: 0.0, bottom: 1.0 },
        { col: 'R', top: 0.0, bottom: last.ny },
      ];
    }
    return [{ col: 'L', top: 0.0, bottom: last.ny }];
  }

  // ---- Middle page ----
  return [{ col: 'full', top: 0.0, bottom: 1.0 }];
}

// ---------------------------------------------------------------------------
// Core: blockOverlaps
// ---------------------------------------------------------------------------

/**
 * Test whether a DLA block's normalized bbox overlaps with any of the
 * column bounds on its page.
 */
export function blockOverlaps(
  bbox: NormalizedBBox,
  pageBounds: ColumnBounds[],
): boolean {
  const bTop = bbox.y;
  const bBottom = bbox.y + bbox.h;
  const bLeft = bbox.x;
  const bCenterX = bLeft + bbox.w / 2;
  // A block wider than half the page is considered cross-column
  const isCrossColBlock = bbox.w > COL_MID;

  for (const bounds of pageBounds) {
    // Vertical overlap check
    if (bBottom <= bounds.top || bTop >= bounds.bottom) continue;

    // Column check
    if (bounds.col === 'full' || isCrossColBlock) {
      return true;
    }

    const blockCol = bCenterX < COL_MID ? 'L' : 'R';
    if (blockCol === bounds.col) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Utility: create DragPoint from mouse event + page element
// ---------------------------------------------------------------------------

/**
 * Build a DragPoint from a mouse event and the target page's slot element.
 * Returns null if the event is not inside a page slot.
 *
 * NOTE: This is the only function with DOM dependency. It's kept here for
 * co-location but is only called from the hook (useSelectionMachine).
 */
export function dragPointFromEvent(
  e: MouseEvent,
  pageEl: HTMLElement,
  pageNumber: number,
): DragPoint {
  const rect = pageEl.getBoundingClientRect();
  return {
    page: pageNumber,
    nx: clamp01((e.clientX - rect.left) / rect.width),
    ny: clamp01((e.clientY - rect.top) / rect.height),
    clientX: e.clientX,
    clientY: e.clientY,
  };
}

/**
 * Recompute a DragPoint's normalized coords from its stored clientX/Y
 * using a fresh page element rect. Used for scroll compensation on mouseup.
 */
export function recalibrateDragPoint(
  point: DragPoint,
  pageEl: HTMLElement,
): DragPoint {
  const rect = pageEl.getBoundingClientRect();
  return {
    ...point,
    nx: clamp01((point.clientX - rect.left) / rect.width),
    ny: clamp01((point.clientY - rect.top) / rect.height),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
