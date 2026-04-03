import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ensureWorkerInitialized,
  CMAP_URL,
  CMAP_PACKED,
  STANDARD_FONT_URL,
  WASM_URL,
} from './pdfWorkerManager';

export type PDFDocumentSource =
  | { kind: 'data'; data: ArrayBuffer | Uint8Array }
  | { kind: 'file'; path: string };

export function filePathToPdfJsUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment)
      ? segment
      : encodeURIComponent(segment)))
    .join('/');
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

export class PDFDocumentManager {
  private document: PDFDocumentProxy | null = null;
  private loadingTask: { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> } | null = null;
  /** §5.4: Track in-flight page render tasks for cancellation on destroy. */
  private activeRenderTasks: Set<{ cancel(): void }> = new Set();

  async loadDocument(source: PDFDocumentSource): Promise<PDFDocumentProxy> {
    // Cancel previous document if switching PDFs without explicit destroy
    if (this.document) {
      await this.destroy();
    }

    const pdfjsLib = await import('pdfjs-dist');
    ensureWorkerInitialized(pdfjsLib);

    this.loadingTask = pdfjsLib.getDocument({
      ...(source.kind === 'data'
        ? { data: source.data }
        : { url: filePathToPdfJsUrl(source.path) }),
      cMapUrl: CMAP_URL,
      cMapPacked: CMAP_PACKED,
      standardFontDataUrl: STANDARD_FONT_URL,
      wasmUrl: WASM_URL,
    });

    const doc = await this.loadingTask.promise;
    this.document = doc;
    this.loadingTask = null;
    return doc;
  }

  /** Register an in-flight render task so it can be cancelled on destroy. */
  trackRenderTask(task: { cancel(): void }): void {
    this.activeRenderTasks.add(task);
  }

  /** Unregister a completed render task. */
  untrackRenderTask(task: { cancel(): void }): void {
    this.activeRenderTasks.delete(task);
  }

  getDocument(): PDFDocumentProxy | null {
    return this.document;
  }

  getNumPages(): number {
    if (this.document == null) {
      return 0;
    }
    return this.document.numPages;
  }

  async destroy(): Promise<void> {
    // §5.4: Cancel all in-flight page render tasks before destroying the document
    for (const task of this.activeRenderTasks) {
      try { task.cancel(); } catch { /* already finished */ }
    }
    this.activeRenderTasks.clear();

    if (this.loadingTask != null) {
      await this.loadingTask.destroy();
      this.loadingTask = null;
    }
    if (this.document != null) {
      await this.document.destroy();
      this.document = null;
    }
  }
}
