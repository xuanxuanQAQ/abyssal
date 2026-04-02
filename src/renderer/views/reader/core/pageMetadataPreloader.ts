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

export interface PageMetadataPreloadOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onBatch?: (entries: Array<[number, PageMetadata]>) => void;
  batchSize?: number;
}

function toPageMetadata(
  page: {
    getViewport(params: { scale: number }): { width: number; height: number };
    view: number[];
  },
): PageMetadata {
  const viewport = page.getViewport({ scale: 1 });
  const view = page.view;
  const minX = view[0] ?? 0;
  const minY = view[1] ?? 0;
  const maxX = view[2] ?? viewport.width;
  const maxY = view[3] ?? viewport.height;

  return {
    baseWidth: viewport.width,
    baseHeight: viewport.height,
    cropBox: { minX, minY, maxX, maxY },
  };
}

export async function readPageMetadata(
  pdfDocument: PDFDocumentLike,
  pageNumber: number,
): Promise<PageMetadata> {
  const page = await pdfDocument.getPage(pageNumber);
  return toPageMetadata(page);
}

export function buildEstimatedPageMetadataMap(
  numPages: number,
  seedMetadata: PageMetadata,
): PageMetadataMap {
  const metadata: PageMetadataMap = new Map();
  for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
    metadata.set(pageNumber, {
      baseWidth: seedMetadata.baseWidth,
      baseHeight: seedMetadata.baseHeight,
      cropBox: { ...seedMetadata.cropBox },
    });
  }
  return metadata;
}

export async function preloadRemainingPageMetadata(
  pdfDocument: PDFDocumentLike,
  numPages: number,
  options: PageMetadataPreloadOptions = {},
): Promise<PageMetadataMap> {
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const batchSize = Math.max(1, options.batchSize ?? concurrency);
  const metadata: PageMetadataMap = new Map();
  const pendingUpdates: Array<[number, PageMetadata]> = [];
  let nextPageNumber = 2;

  const flushPending = () => {
    if (pendingUpdates.length === 0) return;
    const entries = pendingUpdates.splice(0, pendingUpdates.length);
    options.onBatch?.(entries);
  };

  const worker = async () => {
    while (nextPageNumber <= numPages) {
      if (options.signal?.aborted) return;
      const pageNumber = nextPageNumber;
      nextPageNumber += 1;

      const pageMetadata = await readPageMetadata(pdfDocument, pageNumber);
      metadata.set(pageNumber, pageMetadata);
      pendingUpdates.push([pageNumber, pageMetadata]);

      if (pendingUpdates.length >= batchSize) {
        flushPending();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(numPages - 1, 0)) }, () => worker()));
  flushPending();
  return metadata;
}

export async function preloadAllPageMetadata(
  pdfDocument: PDFDocumentLike,
  numPages: number,
  options: PageMetadataPreloadOptions = {},
): Promise<PageMetadataMap> {
  if (numPages <= 0) {
    return new Map();
  }

  const firstPageMetadata = await readPageMetadata(pdfDocument, 1);
  const metadata = buildEstimatedPageMetadataMap(numPages, firstPageMetadata);

  if (numPages === 1) {
    return metadata;
  }

  const remainingMetadata = await preloadRemainingPageMetadata(pdfDocument, numPages, options);
  for (const [pageNumber, pageMetadata] of remainingMetadata) {
    metadata.set(pageNumber, pageMetadata);
  }

  return metadata;
}
