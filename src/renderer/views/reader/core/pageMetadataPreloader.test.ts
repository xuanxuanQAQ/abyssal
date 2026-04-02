import { describe, expect, it, vi } from 'vitest';
import {
  buildEstimatedPageMetadataMap,
  preloadAllPageMetadata,
  preloadRemainingPageMetadata,
  readPageMetadata,
  type PDFDocumentLike,
} from './pageMetadataPreloader';

function makePage(width: number, height: number, view: number[] = [0, 0, width, height]) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    view,
  };
}

describe('pageMetadataPreloader', () => {
  it('reads page metadata from viewport and crop box', async () => {
    const doc: PDFDocumentLike = {
      numPages: 1,
      getPage: vi.fn(async () => makePage(600, 800, [10, 20, 610, 820])),
    };

    await expect(readPageMetadata(doc, 1)).resolves.toEqual({
      baseWidth: 600,
      baseHeight: 800,
      cropBox: { minX: 10, minY: 20, maxX: 610, maxY: 820 },
    });
  });

  it('builds an estimated metadata map from the first page', () => {
    const map = buildEstimatedPageMetadataMap(3, {
      baseWidth: 612,
      baseHeight: 792,
      cropBox: { minX: 0, minY: 0, maxX: 612, maxY: 792 },
    });

    expect(map).toHaveProperty('size', 3);
    expect(map.get(2)).toEqual(map.get(1));
  });

  it('preloads remaining pages and emits batched updates', async () => {
    const doc: PDFDocumentLike = {
      numPages: 4,
      getPage: vi.fn(async (pageNumber: number) => makePage(500 + pageNumber, 700 + pageNumber)),
    };
    const batches: number[][] = [];

    const metadata = await preloadRemainingPageMetadata(doc, 4, {
      concurrency: 2,
      batchSize: 2,
      onBatch: (entries) => {
        batches.push(entries.map(([pageNumber]) => pageNumber));
      },
    });

    expect(Array.from(metadata.keys()).sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(batches.flat().sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('preloads all pages while keeping the first page as the seed', async () => {
    const doc: PDFDocumentLike = {
      numPages: 3,
      getPage: vi.fn(async (pageNumber: number) => makePage(600 + pageNumber, 800 + pageNumber)),
    };

    const metadata = await preloadAllPageMetadata(doc, 3, { concurrency: 2 });

    expect(metadata.get(1)?.baseWidth).toBe(601);
    expect(metadata.get(3)?.baseHeight).toBe(803);
  });
});