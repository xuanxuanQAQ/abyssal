/**
 * 【Δ-5】CropBox-aware coordinate normalization.
 *
 * Converts between raw PDF coordinates and [0, 1] normalized coordinates
 * relative to a page's CropBox.
 *
 *   W_crop = maxX - minX
 *   H_crop = maxY - minY
 *   x_norm = (x_pdf - minX) / W_crop
 *   y_norm = (y_pdf - minY) / H_crop
 *   x_pdf  = x_norm * W_crop + minX
 *   y_pdf  = y_norm * H_crop + minY
 */

export interface CropBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a PDF point to normalized [0, 1] coordinates within the CropBox.
 */
export function pdfToNormalized(
  x: number,
  y: number,
  cropBox: CropBox,
): { x: number; y: number } {
  const wCrop = cropBox.maxX - cropBox.minX;
  const hCrop = cropBox.maxY - cropBox.minY;
  return {
    x: (x - cropBox.minX) / wCrop,
    y: (y - cropBox.minY) / hCrop,
  };
}

/**
 * Convert a normalized [0, 1] point back to PDF coordinates within the
 * CropBox.
 */
export function normalizedToPDF(
  x: number,
  y: number,
  cropBox: CropBox,
): { x: number; y: number } {
  const wCrop = cropBox.maxX - cropBox.minX;
  const hCrop = cropBox.maxY - cropBox.minY;
  return {
    x: x * wCrop + cropBox.minX,
    y: y * hCrop + cropBox.minY,
  };
}

/**
 * Convert a PDF-space rectangle to normalized coordinates.
 */
export function rectPdfToNormalized(rect: Rect, cropBox: CropBox): Rect {
  const wCrop = cropBox.maxX - cropBox.minX;
  const hCrop = cropBox.maxY - cropBox.minY;
  return {
    x: (rect.x - cropBox.minX) / wCrop,
    y: (rect.y - cropBox.minY) / hCrop,
    width: rect.width / wCrop,
    height: rect.height / hCrop,
  };
}

/**
 * Convert a normalized rectangle back to PDF-space coordinates.
 */
export function rectNormalizedToPDF(rect: Rect, cropBox: CropBox): Rect {
  const wCrop = cropBox.maxX - cropBox.minX;
  const hCrop = cropBox.maxY - cropBox.minY;
  return {
    x: rect.x * wCrop + cropBox.minX,
    y: rect.y * hCrop + cropBox.minY,
    width: rect.width * wCrop,
    height: rect.height * hCrop,
  };
}
