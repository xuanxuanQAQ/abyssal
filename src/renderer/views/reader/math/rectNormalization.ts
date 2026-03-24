/**
 * 【Δ-2】getClientRects() rect cleaning pipeline.
 *
 * Three-step pipeline that takes raw DOMRect[] from Range.getClientRects()
 * and produces cleaned, row-aligned, gap-bridged rectangles.
 *
 * Step 1 — Row Clustering:
 *   Sort by `top`, group rects where |a.top - b.top| < height * 0.3
 *   using a greedy scan.
 *
 * Step 2 — Intra-Row Alignment:
 *   For each row, set unified top = median(rect_i.top),
 *   height = avg(rect_i.height), and update each rect.
 *
 * Step 3 — Gap Bridging:
 *   Within each row, sort by left. If rect[i+1].left - rect[i].right
 *   < avgCharWidth * 0.5, extend rect[i].right to rect[i+1].left.
 *   avgCharWidth = avg(width / textLength) where textLength defaults
 *   to width / 8.
 */

export interface CleanedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface MutableRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function toMutable(rect: DOMRect): MutableRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}

/**
 * Step 1: Cluster rects into rows by vertical proximity.
 *
 * Sorts rects by `top` and greedily groups consecutive rects whose
 * `top` values differ by less than `height * 0.3`.
 */
function clusterIntoRows(rects: MutableRect[]): MutableRect[][] {
  if (rects.length === 0) {
    return [];
  }

  const sorted = [...rects].sort((a, b) => a.top - b.top);
  const rows: MutableRect[][] = [[sorted[0]!]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const currentRow = rows[rows.length - 1]!;
    const representative = currentRow[0]!;
    const threshold = representative.height * 0.3;

    if (Math.abs(current.top - representative.top) < threshold) {
      currentRow.push(current);
    } else {
      rows.push([current]);
    }
  }

  return rows;
}

/**
 * Step 2: Align rects within each row to a unified top and height.
 *
 * Sets `top` to the median of all rect tops in the row and `height`
 * to the average of all rect heights.
 */
function alignRows(rows: MutableRect[][]): void {
  for (const row of rows) {
    const tops = row.map((r) => r.top);
    const heights = row.map((r) => r.height);

    const unifiedTop = median(tops);
    const unifiedHeight = average(heights);

    for (const rect of row) {
      rect.top = unifiedTop;
      rect.height = unifiedHeight;
      rect.bottom = unifiedTop + unifiedHeight;
    }
  }
}

/**
 * Step 3: Bridge small horizontal gaps between adjacent rects in each row.
 *
 * If the gap between consecutive rects is less than half the average
 * character width, the first rect is extended to close the gap.
 */
function bridgeGaps(rows: MutableRect[][]): void {
  for (const row of rows) {
    if (row.length < 2) {
      continue;
    }

    row.sort((a, b) => a.left - b.left);

    // Estimate average character width: avg(width / textLength),
    // where textLength defaults to width / 8 when unknown.
    const charWidths = row.map((r) => {
      const textLength = r.width / 8;
      return textLength > 0 ? r.width / textLength : 0;
    });
    const avgCharWidth = average(charWidths);

    if (avgCharWidth <= 0) {
      continue;
    }

    const gapThreshold = avgCharWidth * 0.5;

    for (let i = 0; i < row.length - 1; i++) {
      const current = row[i]!;
      const next = row[i + 1]!;
      const gap = next.left - current.right;
      if (gap > 0 && gap < gapThreshold) {
        current.right = next.left;
        current.width = current.right - current.left;
      }
    }
  }
}

/**
 * Clean an array of DOMRects through the three-step pipeline:
 * row clustering, intra-row alignment, and gap bridging.
 */
export function cleanClientRects(rects: DOMRect[]): CleanedRect[] {
  if (rects.length === 0) {
    return [];
  }

  // Filter out zero-dimension rects.
  const valid = rects.filter((r) => r.width > 0 && r.height > 0);
  if (valid.length === 0) {
    return [];
  }

  const mutable = valid.map(toMutable);
  const rows = clusterIntoRows(mutable);
  alignRows(rows);
  bridgeGaps(rows);

  const result: CleanedRect[] = [];
  for (const row of rows) {
    for (const rect of row) {
      result.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    }
  }

  return result;
}

/**
 * Compute the axis-aligned bounding box of an array of CleanedRects.
 *
 * @returns The bounding box, or `null` if the input array is empty.
 */
export function computeBoundingBox(rects: CleanedRect[]): CleanedRect | null {
  if (rects.length === 0) {
    return null;
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    if (rect.left < left) left = rect.left;
    if (rect.top < top) top = rect.top;
    if (rect.right > right) right = rect.right;
    if (rect.bottom > bottom) bottom = rect.bottom;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}
