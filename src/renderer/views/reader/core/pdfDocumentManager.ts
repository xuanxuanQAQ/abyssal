import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ensureWorkerInitialized,
  CMAP_URL,
  CMAP_PACKED,
  STANDARD_FONT_URL,
} from './pdfWorkerManager';

export class PDFDocumentManager {
  private document: PDFDocumentProxy | null = null;
  private loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
  /** §5.4: Track in-flight page render tasks for cancellation on destroy. */
  private activeRenderTasks: Set<{ cancel(): void }> = new Set();

  async loadDocument(buffer: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
    // Cancel previous document if switching PDFs without explicit destroy
    if (this.document) {
      await this.destroy();
    }

    ensureWorkerInitialized();

    this.loadingTask = pdfjsLib.getDocument({
      data: buffer,
      cMapUrl: CMAP_URL,
      cMapPacked: CMAP_PACKED,
      standardFontDataUrl: STANDARD_FONT_URL,
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
