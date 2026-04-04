import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlockDTO } from '../../../../shared-types/models';

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
});

describe('useLayoutBlocks', () => {
  let container: HTMLDivElement;
  let root: Root;
  let listeners: Array<(event: { paperId: string; pageIndex: number; blocks: ContentBlockDTO[] }) => void>;
  let onRender: ReturnType<typeof vi.fn>;
  let getDocumentBlocks: ReturnType<typeof vi.fn>;
  let analyzeDocument: ReturnType<typeof vi.fn>;
  let analyze: ReturnType<typeof vi.fn>;
  let unsubscribe: ReturnType<typeof vi.fn>;
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
    onRender = vi.fn();
    unsubscribe = vi.fn();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDocumentBlocks = vi.fn(async (paperId: string) => {
      if (paperId === 'paper-a') {
        return [{ pageIndex: 0, blocks: [makeBlock(0)] }];
      }
      if (paperId === 'paper-b') {
        return [{ pageIndex: 2, blocks: [makeBlock(2, 'figure')] }];
      }
      return [];
    });
    analyzeDocument = vi.fn(async () => {});
    analyze = vi.fn(async () => {});

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

    const lastMap = onRender.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;

    expect(getDocumentBlocks).toHaveBeenCalledWith('paper-a');
    expect(analyzeDocument).toHaveBeenCalledWith('paper-a', 'C:/papers/a.pdf', 3);
    expect(analyze).toHaveBeenCalled();
    expect(lastMap.get(0)?.[0]?.type).toBe('text');

    act(() => {
      listeners[0]?.({ paperId: 'paper-a', pageIndex: 1, blocks: [makeBlock(1, 'table')] });
    });

    const pushedMap = onRender.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
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
    const beforeForeignPush = onRender.mock.calls.length;

    act(() => {
      listeners[0]?.({ paperId: 'paper-b', pageIndex: 1, blocks: [makeBlock(1, 'figure')] });
    });

    expect(onRender).toHaveBeenCalledTimes(beforeForeignPush);
  });

  it('clears stale blocks and re-triggers loading on document change', async () => {
    let resolvePaperB: ((value: Array<{ pageIndex: number; blocks: ContentBlockDTO[] }>) => void) | null = null;
    getDocumentBlocks.mockImplementation((paperId: string) => {
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

    const clearedMap = onRender.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(clearedMap.size).toBe(0);
    expect(analyzeDocument).toHaveBeenCalledWith('paper-b', 'C:/papers/b.pdf', 4);

    await act(async () => {
      resolvePaperB?.([{ pageIndex: 2, blocks: [makeBlock(2, 'figure')] }]);
      await Promise.resolve();
    });

    const loadedMap = onRender.mock.calls.at(-1)?.[0] as Map<number, ContentBlockDTO[]>;
    expect(loadedMap.get(2)?.[0]?.type).toBe('figure');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});