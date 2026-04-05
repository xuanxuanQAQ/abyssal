import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ContentBlockDTO } from '../../../../shared-types/models';

type DlaPageEvent = { paperId: string; pageIndex: number; blocks: ContentBlockDTO[] };
type DocumentBlocksResult = Array<{ pageIndex: number; blocks: ContentBlockDTO[] }>;

const bridgeState = vi.hoisted(() => ({
  currentApi: null as null | {
    on: { dlaPageReady: (cb: (event: { paperId: string; pageIndex: number; blocks: ContentBlockDTO[] }) => void) => (() => void) | void };
    dla: {
      getDocumentBlocks: (paperId: string) => Promise<Array<{ pageIndex: number; blocks: ContentBlockDTO[] }>>;
      analyzeDocument: (paperId: string, pdfPath: string, totalPages: number) => Promise<void>;
      analyze: (paperId: string, pdfPath: string, pageIndices: number[]) => Promise<void>;
    };
  },
}));

vi.mock('../../../core/ipc/bridge', () => ({
  getAPI: () => bridgeState.currentApi,
}));

import { groupDocumentBlocksByPage, useLayoutBlocks } from './useLayoutBlocks';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeBlock(pageIndex: number, type: ContentBlockDTO['type'] = 'text'): ContentBlockDTO {
  return {
    type,
    bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    confidence: 0.9,
    pageIndex,
  };
}

function HookProbe(
  props: {
    opts: Parameters<typeof useLayoutBlocks>[0];
    onRender: (map: Map<number, ContentBlockDTO[]>) => void;
  },
) {
  const map = useLayoutBlocks(props.opts);

  useEffect(() => {
    props.onRender(map);
  }, [map, props]);

  return null;
}

describe('groupDocumentBlocksByPage', () => {
  it('builds a page-indexed map from bulk IPC payloads', () => {
    const grouped = groupDocumentBlocksByPage([
      { pageIndex: 0, blocks: [{ type: 'text', bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.9, pageIndex: 0 }] },
      { pageIndex: 2, blocks: [{ type: 'figure', bbox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, confidence: 0.8, pageIndex: 2 }] },
    ]);

    expect(grouped.get(0)).toHaveLength(1);
    expect(grouped.get(2)?.[0]?.type).toBe('figure');
  });

  it('normalizes out-of-order payloads by block pageIndex and preserves empty pages', () => {
    const grouped = groupDocumentBlocksByPage([
      { pageIndex: 2, blocks: [] },
      {
        pageIndex: 0,
        blocks: [
          { type: 'text', bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.9, pageIndex: 1 },
          { type: 'figure', bbox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, confidence: 0.8, pageIndex: 2 },
        ],
      },
    ]);

    expect(grouped.get(1)?.[0]?.type).toBe('text');
    expect(grouped.get(2)?.[0]?.type).toBe('figure');
  });
});

describe('useLayoutBlocks', () => {
  let container: HTMLDivElement;
  let root: Root;
  let listeners: Array<(event: DlaPageEvent) => void>;
  let onRender: (map: Map<number, ContentBlockDTO[]>) => void;
  let onRenderSpy: Mock<(map: Map<number, ContentBlockDTO[]>) => void>;
  let getDocumentBlocks: (paperId: string) => Promise<DocumentBlocksResult>;
  let getDocumentBlocksSpy: Mock<(paperId: string) => Promise<DocumentBlocksResult>>;
  let analyzeDocument: (paperId: string, pdfPath: string, totalPages: number) => Promise<void>;
  let analyzeDocumentSpy: Mock<(paperId: string, pdfPath: string, totalPages: number) => Promise<void>>;
  let analyze: (paperId: string, pdfPath: string, pageIndices: number[]) => Promise<void>;
  let analyzeSpy: Mock<(paperId: string, pdfPath: string, pageIndices: number[]) => Promise<void>>;
  let unsubscribe: () => void;
  let unsubscribeSpy: Mock<() => void>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    listeners = [];
    onRenderSpy = vi.fn();
    onRender = (map) => { onRenderSpy(map); };
    unsubscribeSpy = vi.fn();
    unsubscribe = () => { unsubscribeSpy(); };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDocumentBlocksSpy = vi.fn(async (paperId: string) => {
      if (paperId === 'paper-a') {
        return [{ pageIndex: 0, blocks: [makeBlock(0)] }];
      }
      if (paperId === 'paper-b') {
        return [{ pageIndex: 2, blocks: [makeBlock(2, 'figure')] }];
      }
      return [];
    });
    getDocumentBlocks = (paperId) => getDocumentBlocksSpy(paperId);
    analyzeDocumentSpy = vi.fn(async () => {});
    analyzeDocument = (paperId, pdfPath, totalPages) => analyzeDocumentSpy(paperId, pdfPath, totalPages);
    analyzeSpy = vi.fn(async () => {});
    analyze = (paperId, pdfPath, pageIndices) => analyzeSpy(paperId, pdfPath, pageIndices);

    bridgeState.currentApi = {
      on: {
        dlaPageReady: (cb) => {
          listeners.push(cb);
          return unsubscribe;
        },
      },
      dla: {
        getDocumentBlocks,
        analyzeDocument,
        analyze,
      },
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    bridgeState.currentApi = null;
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('loads cached blocks, subscribes to push updates, and triggers analysis for incomplete pages', async () => {
    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-a',
            pdfPath: 'C:/papers/a.pdf',
            totalPages: 3,
            currentPage: 1,
            enabled: true,
          },
          onRender,
        }),
      );
    });

    await flushEffects();

    const lastMap = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;

    expect(getDocumentBlocksSpy).toHaveBeenCalledWith('paper-a');
    expect(analyzeDocumentSpy).toHaveBeenCalledWith('paper-a', 'C:/papers/a.pdf', 3);
    expect(analyzeSpy).toHaveBeenCalled();
    expect(lastMap.get(0)?.[0]?.type).toBe('text');

    act(() => {
      listeners[0]?.({ paperId: 'paper-a', pageIndex: 1, blocks: [makeBlock(1, 'table')] });
    });

    const pushedMap = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(pushedMap.get(1)?.[0]?.type).toBe('table');
  });

  it('ignores push events for other papers', async () => {
    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-a',
            pdfPath: 'C:/papers/a.pdf',
            totalPages: 2,
            currentPage: 1,
            enabled: true,
          },
          onRender,
        }),
      );
    });

    await flushEffects();
    const beforeForeignPush = onRenderSpy.mock.calls.length;

    act(() => {
      listeners[0]?.({ paperId: 'paper-b', pageIndex: 1, blocks: [makeBlock(1, 'figure')] });
    });

    expect(onRenderSpy).toHaveBeenCalledTimes(beforeForeignPush);
  });

  it('clears stale blocks and re-triggers loading on document change', async () => {
    let resolvePaperB: ((value: Array<{ pageIndex: number; blocks: ContentBlockDTO[] }>) => void) | null = null;
    getDocumentBlocksSpy.mockImplementation((paperId: string) => {
      if (paperId === 'paper-a') {
        return Promise.resolve([{ pageIndex: 0, blocks: [makeBlock(0)] }]);
      }
      return new Promise((resolve) => {
        resolvePaperB = resolve;
      });
    });

    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-a',
            pdfPath: 'C:/papers/a.pdf',
            totalPages: 2,
            currentPage: 1,
            enabled: true,
          },
          onRender,
        }),
      );
    });
    await flushEffects();

    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-b',
            pdfPath: 'C:/papers/b.pdf',
            totalPages: 4,
            currentPage: 2,
            enabled: true,
          },
          onRender,
        }),
      );
    });
    await flushEffects();

    const clearedMap = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(clearedMap.size).toBe(0);
    expect(analyzeDocumentSpy).toHaveBeenCalledWith('paper-b', 'C:/papers/b.pdf', 4);

    await act(async () => {
      resolvePaperB?.([{ pageIndex: 2, blocks: [makeBlock(2, 'figure')] }]);
      await Promise.resolve();
    });

    const loadedMap = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(loadedMap.get(2)?.[0]?.type).toBe('figure');
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps empty persisted payloads consumable and normalizes blocks by actual page index', async () => {
    getDocumentBlocksSpy.mockResolvedValue([
      { pageIndex: 2, blocks: [] },
      {
        pageIndex: 0,
        blocks: [
          makeBlock(1, 'text'),
          makeBlock(2, 'figure'),
        ],
      },
    ]);

    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-a',
            pdfPath: 'C:/papers/a.pdf',
            totalPages: 3,
            currentPage: 1,
            enabled: true,
          },
          onRender,
        }),
      );
    });

    await flushEffects();

    const map = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(map.get(1)?.[0]?.pageIndex).toBe(1);
    expect(map.get(2)?.[0]?.type).toBe('figure');
    expect(analyzeDocumentSpy).toHaveBeenCalledWith('paper-a', 'C:/papers/a.pdf', 3);
  });

  it('boosts nearby missing pages around the current viewport and merges cross-page push updates', async () => {
    getDocumentBlocksSpy.mockResolvedValue([
      { pageIndex: 2, blocks: [makeBlock(2, 'text')] },
    ]);

    await act(async () => {
      root.render(
        createElement(HookProbe, {
          opts: {
            paperId: 'paper-a',
            pdfPath: 'C:/papers/a.pdf',
            totalPages: 6,
            currentPage: 4,
            enabled: true,
          },
          onRender,
        }),
      );
    });

    await flushEffects();

    expect(analyzeSpy).toHaveBeenCalledWith('paper-a', 'C:/papers/a.pdf', [1, 3, 4, 5]);

    act(() => {
      listeners[0]?.({ paperId: 'paper-a', pageIndex: 5, blocks: [makeBlock(5, 'table')] });
    });

    const pushedMap = onRenderSpy.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(pushedMap.get(2)?.[0]?.type).toBe('text');
    expect(pushedMap.get(5)?.[0]?.type).toBe('table');
  });
});