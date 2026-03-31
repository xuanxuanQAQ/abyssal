import * as pdfjsLib from 'pdfjs-dist';

let initialized = false;

// Assets are copied to dist/renderer/pdfjs/ by vite-plugin-static-copy.
// In dev mode, Vite serves them from the same base.
// Use a path relative to the HTML document (base: './').
export const CMAP_URL = new URL('./pdfjs/cmaps/', document.baseURI).href;
export const STANDARD_FONT_URL = new URL('./pdfjs/standard_fonts/', document.baseURI).href;
export const CMAP_PACKED = true;

console.log('[pdfjs] CMAP_URL:', CMAP_URL);
console.log('[pdfjs] STANDARD_FONT_URL:', STANDARD_FONT_URL);
console.log('[pdfjs] document.baseURI:', document.baseURI);

export function ensureWorkerInitialized(): void {
  if (initialized) {
    return;
  }
  const workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  console.log('[pdfjs] workerSrc:', workerSrc);
  initialized = true;
}
