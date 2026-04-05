import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateConceptDialog } from './CreateConceptDialog';

const createMutateMock = vi.fn();
const acceptMutateMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const table: Record<string, string> = {
        'analysis.concepts.create.title': '创建新概念',
        'analysis.concepts.create.nameEn': '英文名',
        'analysis.concepts.create.nameZh': '中文名',
        'analysis.concepts.create.definition': '定义',
        'analysis.concepts.create.keywordsHint': '关键词',
        'analysis.concepts.create.creating': '创建中…',
        'analysis.concepts.create.createTentative': '创建 (tentative)',
        'common.cancel': '取消',
      };
      return table[key] ?? key;
    },
  }),
}));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <>{children}</> : null),
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Overlay: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Content: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Title: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Description: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  Close: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../core/ipc/hooks/useConcepts', () => ({
  useCreateConcept: () => ({
    mutate: createMutateMock,
    isPending: false,
  }),
}));

vi.mock('../../../../core/ipc/hooks/useSuggestedConcepts', () => ({
  useAcceptSuggestedConcept: () => ({
    mutate: acceptMutateMock,
    isPending: false,
  }),
}));

describe('CreateConceptDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    createMutateMock.mockReset();
    acceptMutateMock.mockReset();
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

  it('creates a concept from Chinese-only input and mirrors the name into nameEn', () => {
    const onCreated = vi.fn();
    createMutateMock.mockImplementation((draft, options) => {
      options?.onSuccess?.({ id: 'concept-zh' });
    });

    act(() => {
      root.render(
        <CreateConceptDialog
          open
          onOpenChange={() => {}}
          prefillNameZh="中文概念"
          onCreated={onCreated}
        />,
      );
    });

    const createButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('创建 (tentative)'));
    expect(createButton?.hasAttribute('disabled')).toBe(false);

    act(() => {
      createButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nameEn: '中文概念',
        nameZh: '中文概念',
      }),
      expect.any(Object),
    );
    expect(onCreated).toHaveBeenCalledWith('concept-zh');
  });

  it('resets prefilled values when reopened for a different suggestion', () => {
    act(() => {
      root.render(
        <CreateConceptDialog
          open
          onOpenChange={() => {}}
          prefillNameEn="First concept"
        />,
      );
    });

    const firstInput = container.querySelector('input');
    expect(firstInput).toBeTruthy();
    expect((firstInput as HTMLInputElement).value).toBe('First concept');

    act(() => {
      (firstInput as HTMLInputElement).value = 'Edited concept';
      firstInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      root.render(
        <CreateConceptDialog
          open={false}
          onOpenChange={() => {}}
          prefillNameEn="First concept"
        />,
      );
    });

    act(() => {
      root.render(
        <CreateConceptDialog
          open
          onOpenChange={() => {}}
          prefillNameEn="Second concept"
        />,
      );
    });

    const reopenedInput = container.querySelector('input');
    expect((reopenedInput as HTMLInputElement).value).toBe('Second concept');
  });
});