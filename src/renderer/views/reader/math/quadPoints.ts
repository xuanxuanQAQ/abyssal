/**
 * 【Δ-5】CropBox-aware PDF QuadPoints format conversion.
 *
 * Converts normalized rectangles (DOM convention: y=0 at top) to PDF
 * QuadPoints arrays (PDF convention: y=0 at bottom).
 *
 * For each normalized rect:
 *   x0_pdf = rect.x * W_crop + minX
 *   y0_pdf_top = rect.y * H_crop + minY
 *   x1_pdf = (rect.x + rect.width) * W_crop + minX
 *   y1_pdf_bottom = (rect.y + rect.height) * H_crop + minY
 *
 *   // Y flip: normalized y=0 is top (DOM), PDF y=0 is bottom
 *   y0_pdf = maxY - y0_pdf_top + minY   // top edge → high Y in PDF
 *   y1_pdf = maxY - y1_pdf_bottom + minY // bottom edge → low Y in PDF
 *
 *   quadPoint = [x0, y0, x1, y0, x0, y1, x1, y1]
 */

import { type CropBox } from "./normalizedCoords";

interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert an array of normalized rectangles to PDF QuadPoints arrays.
 *
 * Each returned sub-array contains 8 numbers representing the four corners
 * of the quad in PDF coordinate space:
 *   [x0, y0, x1, y0, x0, y1, x1, y1]
 *
 * where (x0, y0) is the top-left in PDF coords (high Y) and (x1, y1) is
 * the bottom-right (low Y).
 */
export function normalizedRectsToQuadPoints(
  rects: Array<NormalizedRect>,
  cropBox: CropBox,
): number[][] {
  const wCrop = cropBox.maxX - cropBox.minX;
  const hCrop = cropBox.maxY - cropBox.minY;

  return rects.map((rect) => {
    const x0Pdf = rect.x * wCrop + cropBox.minX;
    const y0PdfTop = rect.y * hCrop + cropBox.minY;
    const x1Pdf = (rect.x + rect.width) * wCrop + cropBox.minX;
    const y1PdfBottom = (rect.y + rect.height) * hCrop + cropBox.minY;

    // Y flip: normalized y=0 is top (DOM convention), PDF y=0 is bottom
    const y0Pdf = cropBox.maxY - y0PdfTop + cropBox.minY;
    const y1Pdf = cropBox.maxY - y1PdfBottom + cropBox.minY;

    return [x0Pdf, y0Pdf, x1Pdf, y0Pdf, x0Pdf, y1Pdf, x1Pdf, y1Pdf];
  });
}
