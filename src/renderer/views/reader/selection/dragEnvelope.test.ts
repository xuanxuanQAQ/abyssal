import { describe, it, expect } from 'vitest';
import {
  normalizeEndpoints,
  computePageBounds,
  blockOverlaps,
  recalibrateDragPoint,
  type DragPoint,
  type ColumnBounds,
  type NormalizedBBox,
} from './dragEnvelope';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(page: number, nx: number, ny: number): DragPoint {
  return { page, nx, ny, clientX: 0, clientY: 0 };
}

function envelope(start: DragPoint, end: DragPoint) {
  return { start, end };
}

// ---------------------------------------------------------------------------
// normalizeEndpoints
// ---------------------------------------------------------------------------

describe('normalizeEndpoints', () => {
  it('forward drag → unchanged order', () => {
    const { first, last } = normalizeEndpoints(pt(3, 0.2, 0.4), pt(5, 0.8, 0.3));
    expect(first.page).toBe(3);
    expect(last.page).toBe(5);
  });

  it('reverse drag (page 5 → page 3) → swapped', () => {
    const { first, last } = normalizeEndpoints(pt(5, 0.8, 0.3), pt(3, 0.2, 0.4));
    expect(first.page).toBe(3);
    expect(last.page).toBe(5);
  });

  it('same page forward → unchanged', () => {
    const { first, last } = normalizeEndpoints(pt(3, 0.2, 0.2), pt(3, 0.8, 0.8));
    expect(first.ny).toBe(0.2);
    expect(last.ny).toBe(0.8);
  });

  it('same page reverse → swapped', () => {
    const { first, last } = normalizeEndpoints(pt(3, 0.8, 0.8), pt(3, 0.2, 0.2));
    expect(first.ny).toBe(0.2);
    expect(last.ny).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// computePageBounds — same page
// ---------------------------------------------------------------------------

describe('computePageBounds (same page)', () => {
  it('same page, same column → single tight bounds', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.7, 0.4), pt(3, 0.8, 0.6)), 3);
    expect(bounds).toEqual([{ col: 'R', top: 0.4, bottom: 0.6 }]);
  });

  it('same page, left column → col = L', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.2, 0.3), pt(3, 0.3, 0.7)), 3);
    expect(bounds).toEqual([{ col: 'L', top: 0.3, bottom: 0.7 }]);
  });

  it('same page, reverse drag (bottom → top) → still correct bounds', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.7, 0.8), pt(3, 0.6, 0.2)), 3);
    expect(bounds).toEqual([{ col: 'R', top: 0.2, bottom: 0.8 }]);
  });

  it('same page, cross-column (L→R) → two column bounds', () => {
    // Start in left col (nx=0.2), end in right col (nx=0.7)
    const bounds = computePageBounds(envelope(pt(3, 0.2, 0.6), pt(3, 0.7, 0.3)), 3);
    expect(bounds).toHaveLength(2);
    // Left column: from start ny down to page bottom
    expect(bounds).toContainEqual({ col: 'L', top: 0.6, bottom: 1.0 });
    // Right column: from page top down to end ny
    expect(bounds).toContainEqual({ col: 'R', top: 0.0, bottom: 0.3 });
  });

  it('same page, cross-column (R→L, reverse) → two column bounds', () => {
    // Start in right col (nx=0.7, ny=0.3), end in left col (nx=0.2, ny=0.6)
    const bounds = computePageBounds(envelope(pt(3, 0.7, 0.3), pt(3, 0.2, 0.6)), 3);
    expect(bounds).toHaveLength(2);
    expect(bounds).toContainEqual({ col: 'L', top: 0.6, bottom: 1.0 });
    expect(bounds).toContainEqual({ col: 'R', top: 0.0, bottom: 0.3 });
  });

  it('page outside envelope → empty', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.5, 0.4), pt(3, 0.5, 0.6)), 4);
    expect(bounds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computePageBounds — cross-page
// ---------------------------------------------------------------------------

describe('computePageBounds (cross-page)', () => {
  it('start page', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.3, 0.8), pt(5, 0.7, 0.3)), 3);
    expect(bounds).toEqual([{ col: 'L', top: 0.8, bottom: 1.0 }]);
  });

  it('middle page → full', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.3, 0.8), pt(5, 0.7, 0.3)), 4);
    expect(bounds).toEqual([{ col: 'full', top: 0.0, bottom: 1.0 }]);
  });

  it('end page', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.3, 0.8), pt(5, 0.7, 0.3)), 5);
    expect(bounds).toEqual([{ col: 'R', top: 0.0, bottom: 0.3 }]);
  });

  it('reverse cross-page (page 5 → page 3) → same result', () => {
    const boundsStartPage = computePageBounds(
      envelope(pt(5, 0.7, 0.3), pt(3, 0.3, 0.8)),
      3,
    );
    expect(boundsStartPage).toEqual([{ col: 'L', top: 0.8, bottom: 1.0 }]);

    const boundsMiddle = computePageBounds(
      envelope(pt(5, 0.7, 0.3), pt(3, 0.3, 0.8)),
      4,
    );
    expect(boundsMiddle).toEqual([{ col: 'full', top: 0.0, bottom: 1.0 }]);

    const boundsEndPage = computePageBounds(
      envelope(pt(5, 0.7, 0.3), pt(3, 0.3, 0.8)),
      5,
    );
    expect(boundsEndPage).toEqual([{ col: 'R', top: 0.0, bottom: 0.3 }]);
  });

  it('page before range → empty', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.3, 0.8), pt(5, 0.7, 0.3)), 2);
    expect(bounds).toEqual([]);
  });

  it('page after range → empty', () => {
    const bounds = computePageBounds(envelope(pt(3, 0.3, 0.8), pt(5, 0.7, 0.3)), 6);
    expect(bounds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// blockOverlaps
// ---------------------------------------------------------------------------

describe('blockOverlaps', () => {
  it('block inside single-column bounds → true', () => {
    const bbox: NormalizedBBox = { x: 0.6, y: 0.45, w: 0.3, h: 0.05 };
    const bounds: ColumnBounds[] = [{ col: 'R', top: 0.4, bottom: 0.6 }];
    expect(blockOverlaps(bbox, bounds)).toBe(true);
  });

  it('block outside vertically → false', () => {
    const bbox: NormalizedBBox = { x: 0.6, y: 0.1, w: 0.3, h: 0.05 };
    const bounds: ColumnBounds[] = [{ col: 'R', top: 0.4, bottom: 0.6 }];
    expect(blockOverlaps(bbox, bounds)).toBe(false);
  });

  it('block in wrong column → false', () => {
    const bbox: NormalizedBBox = { x: 0.1, y: 0.45, w: 0.2, h: 0.05 };
    const bounds: ColumnBounds[] = [{ col: 'R', top: 0.4, bottom: 0.6 }];
    expect(blockOverlaps(bbox, bounds)).toBe(false);
  });

  it('full-page bounds → any block matches', () => {
    const bbox: NormalizedBBox = { x: 0.1, y: 0.3, w: 0.2, h: 0.1 };
    const bounds: ColumnBounds[] = [{ col: 'full', top: 0.0, bottom: 1.0 }];
    expect(blockOverlaps(bbox, bounds)).toBe(true);
  });

  it('cross-column block (w > 0.5) bypasses column check', () => {
    const bbox: NormalizedBBox = { x: 0.1, y: 0.45, w: 0.8, h: 0.1 };
    const bounds: ColumnBounds[] = [{ col: 'R', top: 0.4, bottom: 0.6 }];
    expect(blockOverlaps(bbox, bounds)).toBe(true);
  });

  it('two column bounds (cross-column selection) → matches left block', () => {
    const bbox: NormalizedBBox = { x: 0.1, y: 0.7, w: 0.3, h: 0.1 };
    const bounds: ColumnBounds[] = [
      { col: 'L', top: 0.6, bottom: 1.0 },
      { col: 'R', top: 0.0, bottom: 0.3 },
    ];
    expect(blockOverlaps(bbox, bounds)).toBe(true);
  });

  it('two column bounds → does NOT match left block above bounds', () => {
    const bbox: NormalizedBBox = { x: 0.1, y: 0.3, w: 0.3, h: 0.1 };
    const bounds: ColumnBounds[] = [
      { col: 'L', top: 0.6, bottom: 1.0 },
      { col: 'R', top: 0.0, bottom: 0.3 },
    ];
    expect(blockOverlaps(bbox, bounds)).toBe(false);
  });

  it('two column bounds → matches right block in range', () => {
    const bbox: NormalizedBBox = { x: 0.6, y: 0.1, w: 0.3, h: 0.1 };
    const bounds: ColumnBounds[] = [
      { col: 'L', top: 0.6, bottom: 1.0 },
      { col: 'R', top: 0.0, bottom: 0.3 },
    ];
    expect(blockOverlaps(bbox, bounds)).toBe(true);
  });

  it('two column bounds → does NOT match right block below bounds', () => {
    const bbox: NormalizedBBox = { x: 0.6, y: 0.5, w: 0.3, h: 0.1 };
    const bounds: ColumnBounds[] = [
      { col: 'L', top: 0.6, bottom: 1.0 },
      { col: 'R', top: 0.0, bottom: 0.3 },
    ];
    expect(blockOverlaps(bbox, bounds)).toBe(false);
  });

  it('empty bounds → false', () => {
    const bbox: NormalizedBBox = { x: 0.5, y: 0.5, w: 0.3, h: 0.1 };
    expect(blockOverlaps(bbox, [])).toBe(false);
  });
});
