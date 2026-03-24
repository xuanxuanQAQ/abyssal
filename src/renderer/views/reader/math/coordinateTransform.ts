/**
 * PDF ↔ DOM ↔ Canvas coordinate transforms.
 *
 * PDF coordinate system: origin at bottom-left, Y increases upward.
 * DOM coordinate system: origin at top-left, Y increases downward.
 *
 * The viewport.transform matrix [a, b, c, d, e, f] maps PDF → DOM:
 *   x_dom = a * x_pdf + c * y_pdf + e
 *   y_dom = b * x_pdf + d * y_pdf + f
 *
 * When rotation R = 0 (no rotation):
 *   x_dom = S * x_pdf
 *   y_dom = S * (H_pdf - y_pdf)
 *
 * Canvas sizing for HiDPI:
 *   canvas.width  = floor(viewport.width  * devicePixelRatio)
 *   canvas.height = floor(viewport.height * devicePixelRatio)
 */

export type Transform6 = [number, number, number, number, number, number];

/**
 * Transform a point from PDF coordinates to DOM coordinates using the
 * viewport transform matrix.
 */
export function pdfToDOM(
  x: number,
  y: number,
  transform: Transform6,
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

/**
 * Configure an HTMLCanvasElement for HiDPI rendering.
 *
 * Sets the canvas backing-store dimensions to account for the device pixel
 * ratio, then scales the 2D context so that subsequent draw calls use
 * CSS-pixel units.
 *
 * @returns The scaled CanvasRenderingContext2D.
 */
export function setupCanvasForHiDPI(
  canvas: HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number,
  dpr: number,
): CanvasRenderingContext2D {
  canvas.width = Math.floor(viewportWidth * dpr);
  canvas.height = Math.floor(viewportHeight * dpr);

  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to obtain 2D rendering context from canvas");
  }

  ctx.scale(dpr, dpr);
  return ctx;
}
