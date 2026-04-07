import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RowContextMenu } from './RowContextMenu';

const state = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  updatePaper: { mutate: vi.fn(), isPending: false },
  deletePaper: { mutate: vi.fn(), isPending: false },
  acquireFulltext: { mutate: vi.fn(), isPending: false },
  linkLocalPdf: { mutate: vi.fn(), isPending: false },
  resetProcess: { mutate: vi.fn(), isPending: false },
  resetFulltext: { mutate: vi.fn(), isPending: false },
  resetAnalysis: { mutate: vi.fn(), isPending: false },
  startPipeline: { mutate: vi.fn(), isPending: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'library.contextMenu.resetProcess') return '删除处理';
      if (key === 'library.contextMenu.resetProcessConfirm') {
        return `确定删除「${String(options?.title ?? '')}」的提取文本和索引？`;
      }
      if (key === 'common.paper') return '论文';
      return key;
    },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
  },
}));

vi.mock('../../../core/store', () => ({
  useAppStore: (selector: (store: { navigateTo: typeof state.navigateTo }) => unknown) => selector({
    navigateTo: state.navigateTo,
  }),
}));

vi.mock('../../../core/ipc/hooks/usePapers', () => ({
  useUpdatePaper: () => state.updatePaper,
  useDeletePaper: () => state.deletePaper,
  useResetProcess: () => state.resetProcess,
  useResetFulltext: () => state.resetFulltext,
  useResetAnalysis: () => state.resetAnalysis,
}));

vi.mock('../../../core/ipc/hooks/useAcquire', () => ({
  useAcquireFulltext: () => state.acquireFulltext,
  useLinkLocalPdf: () => state.linkLocalPdf,
}));

vi.mock('../../../core/ipc/hooks/usePipeline', () => ({
  useStartPipeline: () => state.startPipeline,
}));

vi.mock('../shared/relevanceConfig', () => ({
  RELEVANCE_CONFIG: [],
}));

vi.mock('@radix-ui/react-context-menu', async () => {
  const ReactModule = await import('react');
  const create = (tag: 'button' | 'div') => {
    return ({ children, onSelect, onClick, ...props }: {
      children?: React.ReactNode;
      onSelect?: () => void;
      onClick?: () => void;
      [key: string]: unknown;
    }) => ReactModule.createElement(
      tag,
      {
        ...props,
        onClick: () => {
          onSelect?.();
          onClick?.();
        },
      },
      children,
    );
  };

  return {
    Root: ({ children }: { children: React.ReactNode }) => <div data-testid="context-root">{children}</div>,
    Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: create('div'),
    Item: create('button'),
    Sub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SubTrigger: create('button'),
    SubContent: create('div'),
    Separator: () => <div data-testid="separator" />,
  };
});

describe('RowContextMenu', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    state.navigateTo.mockReset();
    state.updatePaper.mutate.mockReset();
    state.deletePaper.mutate.mockReset();
    state.acquireFulltext.mutate.mockReset();
    state.linkLocalPdf.mutate.mockReset();
    state.resetProcess.mutate.mockReset();
    state.resetFulltext.mutate.mockReset();
    state.startPipeline.mutate.mockReset();
    rafCallbacks = [];

    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('defers reset-process confirmation until after the menu has been closed', async () => {
    act(() => {
      root.render(
        <RowContextMenu
          paper={{
            id: 'paper-1',
            title: 'Test Paper',
            authors: [],
            year: 2024,
            paperType: 'article',
            relevance: 'medium',
            fulltextStatus: 'available',
            fulltextPath: 'C:/paper.pdf',
            textPath: 'C:/paper.txt',
            analysisStatus: 'idle',
            decisionNote: null,
            dateAdded: '2026-04-06T00:00:00.000Z',
          } as never}
        >
          <div>row</div>
        </RowContextMenu>,
      );
    });

    const resetButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '删除处理');
    expect(resetButton).toBeTruthy();

    act(() => {
      resetButton?.click();
    });

    // action 还没执行（在 RAF 中）
    expect(state.resetProcess.mutate).not.toHaveBeenCalled();

    // flush RAF — async confirm 打开对话框
    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16.7);
      await Promise.resolve();
    });

    // 对话框应该已渲染
    const dialog = document.querySelector('[data-testid="app-dialog"]');
    expect(dialog).toBeTruthy();

    // 点击确认按钮
    const confirmBtn = document.querySelector('[data-dialog-action="confirm"]') as HTMLButtonElement | null;
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
      await Promise.resolve();
    });

    expect(state.resetProcess.mutate).toHaveBeenCalledWith('paper-1');
  });

  it('defers reset-fulltext confirmation until after the menu event completes', async () => {
    act(() => {
      root.render(
        <RowContextMenu
          paper={{
            id: 'paper-1',
            title: 'Test Paper',
            authors: [],
            year: 2024,
            paperType: 'article',
            relevance: 'medium',
            fulltextStatus: 'available',
            fulltextPath: 'C:/paper.pdf',
            textPath: 'C:/paper.txt',
            analysisStatus: 'idle',
            decisionNote: null,
            dateAdded: '2026-04-06T00:00:00.000Z',
          } as never}
        >
          <div>row</div>
        </RowContextMenu>,
      );
    });

    const resetFulltextButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'library.contextMenu.resetFulltext');
    expect(resetFulltextButton).toBeTruthy();

    act(() => {
      resetFulltextButton?.click();
    });

    expect(state.resetFulltext.mutate).not.toHaveBeenCalled();

    // flush RAF — async confirm 打开对话框
    await act(async () => {
      const callback = rafCallbacks.shift();
      callback?.(16.7);
      await Promise.resolve();
    });

    const dialog = document.querySelector('[data-testid="app-dialog"]');
    expect(dialog).toBeTruthy();

    const confirmBtn = document.querySelector('[data-dialog-action="confirm"]') as HTMLButtonElement | null;
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
      await Promise.resolve();
    });

    expect(state.resetFulltext.mutate).toHaveBeenCalledWith('paper-1');
  });

  it('defers navigation until after the menu event completes', () => {
    act(() => {
      root.render(
        <RowContextMenu
          paper={{
            id: 'paper-1',
            title: 'Test Paper',
            authors: [],
            year: 2024,
            paperType: 'article',
            relevance: 'medium',
            fulltextStatus: 'available',
            fulltextPath: 'C:/paper.pdf',
            textPath: null,
            analysisStatus: 'idle',
            decisionNote: null,
            dateAdded: '2026-04-06T00:00:00.000Z',
          } as never}
        >
          <div>row</div>
        </RowContextMenu>,
      );
    });

    const openReaderButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'library.contextMenu.openInReader');
    expect(openReaderButton).toBeTruthy();

    act(() => {
      openReaderButton?.click();
    });

    expect(state.navigateTo).not.toHaveBeenCalled();

    act(() => {
      const callback = rafCallbacks.shift();
      callback?.(16.7);
    });

    expect(state.navigateTo).toHaveBeenCalledWith({ type: 'paper', id: 'paper-1', view: 'reader' });
  });
});