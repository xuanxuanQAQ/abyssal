/**
 * captureBlockRegion — crop a normalized BBox region from a page's canvas.
 *
 * Used by the smart-select flow: when the user clicks a DLA block,
 * we screenshot the block region from the CanvasLayer and return a data URL.
 *
 * Accepts normalized coordinates (0..1) and the page container element
 * (which must contain the CanvasLayer <canvas>).
 */

import type { ImageClip } from '../../../../core/store/useReaderStore';

interface NormalizedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Capture a region from the page's rendered canvas.
 *
 * @param pageContainer - The `[data-page]` div element that wraps the layers
 * @param bbox - Normalized coordinates (0..1 of page dimensions)
 * @param pageNumber - 1-based page number
 * @param blockType - Content block type label (for caption)
 * @returns ImageClip with dataUrl, or null if canvas not available
 */
export function captureBlockRegion(
  pageContainer: HTMLElement,
  bbox: NormalizedBBox,
  pageNumber: number,
  blockType: string,
): ImageClip | null {
  // Find the visible canvas inside the page container (CanvasLayer renders two, one is display:none)
  const canvases = pageContainer.querySelectorAll<HTMLCanvasElement>('canvas');
  let sourceCanvas: HTMLCanvasElement | null = null;
  for (const c of canvases) {
    if (c.style.display !== 'none' && c.width > 0 && c.height > 0) {
      sourceCanvas = c;
      break;
    }
  }
  if (!sourceCanvas) return null;

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  // Convert normalized bbox to pixel coordinates on the physical canvas
  const sx = Math.round(bbox.x * sw);
  const sy = Math.round(bbox.y * sh);
  const sWidth = Math.round(bbox.w * sw);
  const sHeight = Math.round(bbox.h * sh);

  // Guard against zero-size or out-of-bounds
  if (sWidth < 2 || sHeight < 2) return null;

  // Create an offscreen canvas and draw the cropped region
  const offscreen = document.createElement('canvas');
  offscreen.width = sWidth;
  offscreen.height = sHeight;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(sourceCanvas, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

  // Export as JPEG (good balance of quality/size for screenshots)
  const dataUrl = offscreen.toDataURL('image/jpeg', 0.85);

  return {
    type: blockType,
    dataUrl,
    pageNumber,
    bbox,
  };
}
