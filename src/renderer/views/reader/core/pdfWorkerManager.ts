interface PdfJsRuntime {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
}

// Assets are copied to dist/renderer/pdfjs/ by vite-plugin-static-copy.
// In dev mode, Vite serves them from the same base.
// Use a path relative to the HTML document (base: './').
export const CMAP_URL = new URL('./pdfjs/cmaps/', document.baseURI).href;
export const STANDARD_FONT_URL = new URL('./pdfjs/standard_fonts/', document.baseURI).href;
export const WASM_URL = new URL('./pdfjs/wasm/', document.baseURI).href;
export const CMAP_PACKED = true;

let initialized = false;

export function ensureWorkerInitialized(pdfjsLib: PdfJsRuntime): void {
  if (initialized) return;
  initialized = true;
  const workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
}
