import * as pdfjsLib from 'pdfjs-dist';

let initialized = false;

export const CMAP_URL = new URL('pdfjs-dist/cmaps/', import.meta.url).href;
export const STANDARD_FONT_URL = new URL(
  'pdfjs-dist/standard_fonts/',
  import.meta.url,
).href;
export const CMAP_PACKED = true;

export function ensureWorkerInitialized(): void {
  if (initialized) {
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  initialized = true;
}
