import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.hoisted(() => vi.fn());
const ensureWorkerInitialized = vi.hoisted(() => vi.fn());

vi.mock('pdfjs-dist', () => ({
  getDocument,
}));

vi.mock('./pdfWorkerManager', () => ({
  ensureWorkerInitialized,
  CMAP_URL: 'cmap://',
  CMAP_PACKED: true,
  STANDARD_FONT_URL: 'fonts://',
  WASM_URL: 'wasm://',
}));

import { PDFDocumentManager, filePathToPdfJsUrl } from './pdfDocumentManager';

class MockDOMMatrix {
  multiplySelf() {
    return this;
  }
  preMultiplySelf() {
    return this;
  }
  translateSelf() {
    return this;
  }
  scaleSelf() {
    return this;
  }
  rotateSelf() {
    return this;
  }
  invertSelf() {
    return this;
  }
}

if (!('DOMMatrix' in globalThis)) {
  Object.assign(globalThis, { DOMMatrix: MockDOMMatrix });
}

function makeLoadingTask(doc: { numPages: number; destroy: () => Promise<void> }) {
  return {
    promise: Promise.resolve(doc),
    destroy: vi.fn(async () => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('filePathToPdfJsUrl', () => {
  it('converts Windows paths to encoded file URLs for pdf.js', () => {
    expect(filePathToPdfJsUrl('C:\\Users\\xuan xuan\\papers\\sample file.pdf')).toBe(
      'file:///C:/Users/xuan%20xuan/papers/sample%20file.pdf',
    );
  });
});

describe('PDFDocumentManager', () => {
  let manager: PDFDocumentManager;

  beforeEach(() => {
    manager = new PDFDocumentManager();
    getDocument.mockReset();
    ensureWorkerInitialized.mockReset();
  });

  it('loads documents through pdf.js with encoded file URLs', async () => {
    const doc = { numPages: 5, destroy: vi.fn(async () => {}) };
    getDocument.mockReturnValue(makeLoadingTask(doc));

    const loaded = await manager.loadDocument({ kind: 'file', path: 'C:\\papers\\sample file.pdf' });

    expect(loaded).toBe(doc);
    expect(ensureWorkerInitialized).toHaveBeenCalledTimes(1);
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: 'file:///C:/papers/sample%20file.pdf',
      cMapUrl: 'cmap://',
      standardFontDataUrl: 'fonts://',
      wasmUrl: 'wasm://',
    }));
  });

  it('destroys the previous document when switching PDFs', async () => {
    const firstDoc = { numPages: 2, destroy: vi.fn(async () => {}) };
    const secondDoc = { numPages: 7, destroy: vi.fn(async () => {}) };
    getDocument
      .mockReturnValueOnce(makeLoadingTask(firstDoc))
      .mockReturnValueOnce(makeLoadingTask(secondDoc));

    await manager.loadDocument({ kind: 'file', path: 'C:\\papers\\first.pdf' });
    const loaded = await manager.loadDocument({ kind: 'file', path: 'C:\\papers\\second.pdf' });

    expect(firstDoc.destroy).toHaveBeenCalledTimes(1);
    expect(loaded).toBe(secondDoc);
    expect(manager.getNumPages()).toBe(7);
  });

  it('cancels tracked render tasks and destroys loading/document state on destroy', async () => {
    const renderTaskA = { cancel: vi.fn() };
    const renderTaskB = { cancel: vi.fn() };
    const loadingTask = { promise: new Promise(() => {}), destroy: vi.fn(async () => {}) };
    const doc = { numPages: 3, destroy: vi.fn(async () => {}) };

    manager.trackRenderTask(renderTaskA);
    manager.trackRenderTask(renderTaskB);
    (manager as unknown as { loadingTask: typeof loadingTask }).loadingTask = loadingTask;
    (manager as unknown as { document: typeof doc }).document = doc;

    await manager.destroy();

    expect(renderTaskA.cancel).toHaveBeenCalledTimes(1);
    expect(renderTaskB.cancel).toHaveBeenCalledTimes(1);
    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
    expect(manager.getDocument()).toBeNull();
    expect((manager as unknown as { activeRenderTasks: Set<unknown> }).activeRenderTasks.size).toBe(0);
  });

  it('ignores late results from an older load after a newer document has taken over', async () => {
    const firstDoc = { numPages: 2, destroy: vi.fn(async () => {}) };
    const secondDoc = { numPages: 5, destroy: vi.fn(async () => {}) };
    const firstDeferred = deferred<typeof firstDoc>();
    const firstLoadingTask = {
      promise: firstDeferred.promise,
      destroy: vi.fn(async () => {}),
    };

    getDocument.mockReturnValueOnce(firstLoadingTask);

    const firstLoad = manager.loadDocument({ kind: 'file', path: 'C:\\papers\\first.pdf' });

    await vi.waitFor(() => {
      expect(getDocument).toHaveBeenCalledTimes(1);
    });

    (manager as unknown as { loadGeneration: number }).loadGeneration = 2;
    (manager as unknown as { document: typeof secondDoc }).document = secondDoc;
    (manager as unknown as { loadingTask: null }).loadingTask = null;

    firstDeferred.resolve(firstDoc);
    await expect(firstLoad).rejects.toThrow('Document load superseded');

    expect(firstDoc.destroy).toHaveBeenCalledTimes(1);
    expect(manager.getDocument()).toBe(secondDoc);
    expect(manager.getNumPages()).toBe(5);
  });
});