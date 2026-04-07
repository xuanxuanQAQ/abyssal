/**
 * Inverse of a PDF viewport.transform matrix.
 *
 * Given transform [a, b, c, d, e, f], the inverse is:
 *   det = a*d - b*c
 *   [a', b', c', d', e', f'] = [
 *     d/det, -b/det, -c/det, a/det,
 *     (c*f - d*e)/det,
 *     (b*e - a*f)/det
 *   ]
 *
 * This allows mapping DOM coordinates back to PDF coordinates.
 */

import { type Transform6 } from "./coordinateTransform";

/**
 * Compute the inverse of a viewport transform matrix.
 *
 * @throws if the matrix is singular (determinant is zero).
 */
export function computeInverseTransform(transform: Transform6): Transform6 {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;

  if (Math.abs(det) < 1e-6) {
    throw new Error(
      `Cannot invert near-singular transform matrix (determinant: ${det})`,
    );
  }

  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

/**
 * Transform a point from DOM coordinates to PDF coordinates using a
 * precomputed inverse transform matrix.
 */
export function domToPDF(
  x: number,
  y: number,
  inverseTransform: Transform6,
): { x: number; y: number } {
  const [a, b, c, d, e, f] = inverseTransform;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}
