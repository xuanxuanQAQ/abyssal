import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { MemoCard } from './MemoCard';

const deleteMemoMutation = { mutate: vi.fn(), isPending: false };
const updateMemoMutation = { mutate: vi.fn(), isPending: false };
const upgradeToNoteMutation = { mutate: vi.fn(), isPending: false };
const navigateTo = vi.fn();
const selectMemo = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const table: Record<string, string> = {
        'common.edit': '编辑',
        'common.delete': '删除',
        'common.moreActions': '更多操作',
        'notes.memo.expandToNote': '展开为笔记',
        'notes.memo.upgradeToConcept': '升级为概念',
        'notes.memo.justNow': '刚刚',
      };
      return table[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock('../../../core/ipc/hooks/useMemos', () => ({
  useDeleteMemo: () => deleteMemoMutation,
  useUpdateMemo: () => updateMemoMutation,
  useUpgradeMemoToNote: () => upgradeToNoteMutation,
}));

vi.mock('../../../core/store', () => ({
  useAppStore: (selector: (state: { navigateTo: typeof navigateTo; selectMemo: typeof selectMemo }) => unknown) => selector({
    navigateTo,
    selectMemo,
  }),
}));

vi.mock('../../../panels/context/engine/revealContextSource', () => ({
  previewContextSource: vi.fn(),
  cancelPendingContextReveal: vi.fn(),
}));

vi.mock('../note/UpgradeToConceptDialog', () => ({
  UpgradeToConceptDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="upgrade-dialog" /> : null),
}));

describe('MemoCard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    navigateTo.mockReset();
    selectMemo.mockReset();
    deleteMemoMutation.mutate.mockReset();
    updateMemoMutation.mutate.mockReset();
    upgradeToNoteMutation.mutate.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('keeps upgrade to concept as a primary action instead of hiding it under more actions', () => {
    act(() => {
      root.render(
        <MemoCard
          memo={{
            id: 'memo-1',
            text: 'A memo that should be upgraded directly.',
            paperIds: [],
            conceptIds: [],
            linkedNoteIds: [],
            tags: [],
            annotationId: null,
            outlineId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }}
          entityNameCache={{
            getPaperName: (id: string) => id,
            getConceptName: (id: string) => id,
          }}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const upgradeButton = buttons.find((button) => button.getAttribute('title') === '升级为概念');

    expect(upgradeButton).toBeTruthy();
    expect(buttons.some((button) => button.textContent?.includes('更多操作'))).toBe(false);

    act(() => {
      upgradeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="upgrade-dialog"]')).not.toBeNull();
  });
});