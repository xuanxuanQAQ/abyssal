import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WritingView } from './WritingView';

const state = vi.hoisted(() => ({
  selectedSectionId: null as string | null,
  unsavedChanges: false,
  articles: [
    {
      id: 'article-1',
      title: '原文章名',
      metadata: {},
      sections: [],
    },
  ],
  drafts: [
    {
      id: 'draft-1',
      articleId: 'article-1',
      title: '正式论文版',
      status: 'drafting' as const,
      metadata: { writingStyle: 'formal_paper' },
      sections: [],
      basedOnDraftId: null,
      source: 'manual' as const,
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
    },
  ],
  selectSection: vi.fn(),
  createArticle: { mutate: vi.fn(), isPending: false },
  deleteArticle: { mutate: vi.fn(), isPending: false },
  createDraft: { mutate: vi.fn(), isPending: false },
  deleteDraft: { mutate: vi.fn(), isPending: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div data-testid="panel-separator" />,
}));

vi.mock('../../core/store', () => ({
  useAppStore: (selector: (store: { selectedSectionId: string | null; selectSection: typeof state.selectSection }) => unknown) => selector({
    selectedSectionId: state.selectedSectionId,
    selectSection: state.selectSection,
  }),
}));

vi.mock('../../core/store/useEditorStore', () => {
  const hook = (selector: (store: { unsavedChanges: boolean }) => unknown) => selector({
    unsavedChanges: state.unsavedChanges,
  });
  hook.getState = () => ({
    unsavedChanges: state.unsavedChanges,
    clearPersistedWritingTarget: vi.fn(),
    clearDraftStreamText: vi.fn(),
  });
  return { useEditorStore: hook };
});

vi.mock('../../core/hooks/useHotkey', () => ({
  useHotkey: vi.fn(),
}));

vi.mock('./hooks/useArticle', () => ({
  useArticleList: () => ({
    articles: state.articles,
    isLoading: false,
  }),
}));

vi.mock('../../core/ipc/hooks/useArticles', () => ({
  useCreateArticle: () => state.createArticle,
  useDeleteArticle: () => state.deleteArticle,
  useUpdateArticle: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../core/ipc/hooks/useDrafts', () => ({
  useCreateDraft: () => state.createDraft,
  useDeleteDraft: () => state.deleteDraft,
  useDraftList: () => ({ data: state.drafts }),
  useDraftOutline: () => ({ data: state.drafts[0] ?? null }),
  useDraftSectionContent: () => ({ data: null }),
}));

vi.mock('./outline/OutlineTree', () => ({
  OutlineTree: () => <div data-testid="outline-tree" />,
}));

vi.mock('./editor/UnifiedEditor', () => ({
  UnifiedEditor: () => <div data-testid="unified-editor" />,
}));

vi.mock('./export/ExportDialog', () => ({
  ExportDialog: () => null,
}));

vi.mock('./history/VersionHistoryDialog', () => ({
  VersionHistoryDialog: () => null,
}));

describe('WritingView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    state.selectedSectionId = null;
    state.unsavedChanges = false;
    state.selectSection.mockReset();
    state.createArticle.mutate.mockReset();
    state.deleteArticle.mutate.mockReset();
    state.createDraft.mutate.mockReset();
    state.deleteDraft.mutate.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('deletes article with confirmation mentioning routes', async () => {
    act(() => {
      root.render(<WritingView />);
    });

    const articleDeleteButton = container.querySelector('button[aria-label="删除文章"]') as HTMLButtonElement | null;
    expect(articleDeleteButton).not.toBeNull();

    act(() => {
      articleDeleteButton?.click();
    });

    const dialog = document.body.querySelector('[data-testid="app-dialog"]') as HTMLDivElement | null;
    expect(dialog?.textContent).toContain('相关变体也会一并删除');
    expect(state.deleteArticle.mutate).not.toHaveBeenCalled();

    const confirmButton = dialog?.querySelector('[data-dialog-action="confirm"]') as HTMLButtonElement | null;
    expect(confirmButton?.textContent).toBe('删除文章');

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(state.deleteArticle.mutate).toHaveBeenCalledWith('article-1', expect.any(Object));
  });

  it('deletes route with proper confirmation text', async () => {
    act(() => {
      root.render(<WritingView />);
    });

    const routeDeleteButton = container.querySelector('button[aria-label="删除变体"]') as HTMLButtonElement | null;
    expect(routeDeleteButton).not.toBeNull();

    act(() => {
      routeDeleteButton?.click();
    });

    const dialog = document.body.querySelector('[data-testid="app-dialog"]') as HTMLDivElement | null;
    expect(dialog?.textContent).toContain('不影响其他变体');
    expect(state.deleteDraft.mutate).not.toHaveBeenCalled();

    const confirmButton = dialog?.querySelector('[data-dialog-action="confirm"]') as HTMLButtonElement | null;
    expect(confirmButton?.textContent).toBe('删除变体');

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(state.deleteDraft.mutate).toHaveBeenCalledWith('draft-1', expect.any(Object));
  });

  it('renders route tabs inside a horizontal scroll viewport', () => {
    act(() => {
      root.render(<WritingView />);
    });

    const viewport = container.querySelector('[data-draft-tabs-viewport="true"]') as HTMLDivElement | null;
    expect(viewport).not.toBeNull();
    expect(viewport?.parentElement?.style.justifyContent).toBe('flex-end');

    const routeTab = container.querySelector('button[aria-label="当前变体"]') as HTMLButtonElement | null;
    expect(routeTab).not.toBeNull();
    expect(routeTab?.textContent).toContain('正式论文版');
  });

  it('opens create-route dialog with style selector', () => {
    act(() => {
      root.render(<WritingView />);
    });

    const createRouteButton = container.querySelector('button[aria-label="新建变体"]') as HTMLButtonElement | null;
    expect(createRouteButton).not.toBeNull();

    act(() => {
      createRouteButton?.click();
    });

    expect(container.querySelector('h3')?.textContent).toBe('新建写作变体');
    const styleSelect = container.querySelector('select') as HTMLSelectElement | null;
    expect(styleSelect).not.toBeNull();
    expect(styleSelect?.options.length).toBe(5);
  });

  it('shows route count in meta summary', () => {
    act(() => {
      root.render(<WritingView />);
    });

    expect(container.textContent).toContain('1 个变体');
  });
});