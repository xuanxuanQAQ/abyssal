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

  async loadDocument(buffer: ArrayBuffer): Promise<PDFDocumentProxy> {
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
