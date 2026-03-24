import type { CropBox } from '../math/normalizedCoords';

export interface PDFDocumentLike {
  numPages: number;
  getPage(
    pageNumber: number,
  ): Promise<{
    getViewport(params: { scale: number }): { width: number; height: number };
    view: number[];
  }>;
}

export interface PageMetadata {
  baseWidth: number;
  baseHeight: number;
  cropBox: CropBox;
}

export type PageMetadataMap = Map<number, PageMetadata>;

export async function preloadAllPageMetadata(
  pdfDocument: PDFDocumentLike,
  numPages: number,
): Promise<PageMetadataMap> {
  const metadata: PageMetadataMap = new Map();

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const view = page.view;
    const minX = view[0] ?? 0;
    const minY = view[1] ?? 0;
    const maxX = view[2] ?? viewport.width;
    const maxY = view[3] ?? viewport.height;

    metadata.set(i, {
      baseWidth: viewport.width,
      baseHeight: viewport.height,
      cropBox: { minX, minY, maxX, maxY },
    });
  }

  return metadata;
}
