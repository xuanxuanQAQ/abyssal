import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConceptTree } from './ConceptTree';

const useConceptListMock = vi.fn();
const selectConceptMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const table: Record<string, string> = {
        'analysis.concepts.framework': '概念框架',
        'analysis.concepts.empty': '暂无概念，通过 AI 建议或手动创建添加。',
        'analysis.concepts.create.action': '创建概念',
      };
      return table[key] ?? key;
    },
  }),
}));

vi.mock('../../../../core/ipc/hooks/useConcepts', () => ({
  useConceptList: () => useConceptListMock(),
}));

vi.mock('../../../../core/store', () => ({
  useAppStore: (selector: (state: { selectedConceptId: string | null; selectConcept: typeof selectConceptMock }) => unknown) => selector({
    selectedConceptId: null,
    selectConcept: selectConceptMock,
  }),
}));

vi.mock('./ConceptTreeNode', () => ({
  ConceptTreeNode: () => null,
}));

describe('ConceptTree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    useConceptListMock.mockReturnValue({ data: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('renders a manual create action when there are no concepts', () => {
    const onCreateConcept = vi.fn();

    act(() => {
      root.render(<ConceptTree onCreateConcept={onCreateConcept} />);
    });

    const createButtons = Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.includes('创建概念'));
    expect(createButtons.length).toBeGreaterThan(0);

    act(() => {
      createButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCreateConcept).toHaveBeenCalledTimes(1);
  });
});