// @vitest-environment jsdom

import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeState = vi.hoisted(() => ({
  currentApi: null as null | {
    fs: {
      openPDF: (paperId: string) => Promise<{ path: string; data: unknown }>;
    };
  },
}));

const managerState = vi.hoisted(() => ({
  docs: new Map<string, {
    path: string;
    numPages: number;
    doc: {
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport: (_params: { scale: number }) => { width: number; height: number };
        view: number[];
      }>;
    };
    loadPromise?: Promise<void>;
    destroy: ReturnType<typeof vi.fn>;
  }>(),
}));

vi.mock('../../src/renderer/core/ipc/bridge', () => ({
  getAPI: () => bridgeState.currentApi,
}));

vi.mock('../../src/renderer/views/reader/core/pdfDocumentManager', () => {
  class FakePDFDocumentManager {
    private document: unknown = null;
    private numPages = 0;

    async loadDocument(source: { kind: 'data'; data: { paperId: string } }): Promise<unknown> {
      const spec = managerState.docs.get(source.data.paperId)!;
      await spec.loadPromise;
      this.document = spec.doc;
      this.numPages = spec.numPages;
      return spec.doc;
    }

    getDocument(): unknown {
      return this.document;
    }

    getNumPages(): number {
      return this.numPages;
    }

    async destroy(): Promise<void> {
      const spec = Array.from(managerState.docs.values()).find((entry) => entry.doc === this.document);
      spec?.destroy();
      this.document = null;
      this.numPages = 0;
    }
  }

  return { PDFDocumentManager: FakePDFDocumentManager };
});

vi.mock('../../src/renderer/core/hooks/useEventBridge', () => ({
  emitUserAction: vi.fn(),
}));

import { usePDFDocument } from '../../src/renderer/views/reader/hooks/usePDFDocument';
import { useReaderStore } from '../../src/renderer/core/store/useReaderStore';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makePdfDoc(numPages: number, baseWidth: number, baseHeight: number) {
  return {
    numPages,
    getPage: vi.fn(async (pageNumber: number) => ({
      getViewport: () => ({ width: baseWidth + pageNumber, height: baseHeight + pageNumber }),
      view: [0, 0, baseWidth + pageNumber, baseHeight + pageNumber],
    })),
  };
}

function DocumentProbe(props: {
  paperId: string | null;
  onRender: (snapshot: ReturnType<typeof usePDFDocument>) => void;
}) {
  const state = usePDFDocument(props.paperId);

  useEffect(() => {
    props.onRender(state);
  }, [props, state]);

  return null;
}

describe('reader layout flow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRender: ReturnType<typeof vi.fn>;
  let resolvePaperB: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onRender = vi.fn();
    useReaderStore.getState().resetReader();

    const paperALoad = deferred();
    paperALoad.resolve();
    const paperBLoad = deferred();
    resolvePaperB = paperBLoad.resolve;

    managerState.docs = new Map([
      ['paper-a', {
        path: 'C:/papers/a.pdf',
        numPages: 2,
        doc: makePdfDoc(2, 600, 800),
        loadPromise: paperALoad.promise,
        destroy: vi.fn(),
      }],
      ['paper-b', {
        path: 'C:/papers/b.pdf',
        numPages: 4,
        doc: makePdfDoc(4, 700, 900),
        loadPromise: paperBLoad.promise,
        destroy: vi.fn(),
      }],
    ]);

    bridgeState.currentApi = {
      fs: {
        openPDF: vi.fn(async (paperId: string) => ({
          path: managerState.docs.get(paperId)!.path,
          data: { paperId },
        })),
      },
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    bridgeState.currentApi = null;
    useReaderStore.getState().resetReader();
  });

  it('resets reader store state and page metadata when switching documents', async () => {
    await act(async () => {
      root.render(createElement(DocumentProbe, { paperId: 'paper-a', onRender }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRender.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'ready',
      pdfPath: 'C:/papers/a.pdf',
    });
    expect(useReaderStore.getState().totalPages).toBe(2);

    useReaderStore.getState().setQuotedSelection({ text: 'quoted', page: 2 });
    useReaderStore.getState().setSelectionPayload({ text: 'selection', sourcePages: [2] });
    useReaderStore.getState().setCurrentPage(2);

    await act(async () => {
      root.render(createElement(DocumentProbe, { paperId: 'paper-b', onRender }));
    });

    expect(useReaderStore.getState().quotedSelection).toBeNull();
    expect(useReaderStore.getState().selectionPayload).toBeNull();
    expect(useReaderStore.getState().currentPage).toBe(1);
    expect(useReaderStore.getState().totalPages).toBe(0);

    const intermediate = onRender.mock.calls.at(-1)?.[0];
    expect(intermediate).toMatchObject({ status: 'loading', pageMetadataMap: null, pdfPath: null });

    await act(async () => {
      resolvePaperB();
      await Promise.resolve();
      await Promise.resolve();
    });

    const finalState = onRender.mock.calls.at(-1)?.[0];
    expect(finalState).toMatchObject({ status: 'ready', pdfPath: 'C:/papers/b.pdf' });
    expect(finalState.pageMetadataMap?.size).toBe(4);
    expect(useReaderStore.getState().currentPage).toBe(1);
    expect(useReaderStore.getState().totalPages).toBe(4);
    expect(managerState.docs.get('paper-a')?.destroy).toHaveBeenCalledTimes(1);
  });
});