import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConceptSelector } from './ConceptSelector';
import type { Concept } from '../../../../shared-types/models';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const table: Record<string, string> = {
        'reader.annotations.searchConcepts': 'Search concepts',
        'reader.annotations.noMatchingConcepts': 'No matching concepts',
        'reader.annotations.createNewConcept': 'Create new concept',
      };
      return table[key] ?? key;
    },
  }),
}));

vi.mock('@radix-ui/react-popover', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Anchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children, side: _side, align: _align, sideOffset: _sideOffset, ...props }: React.HTMLAttributes<HTMLDivElement> & {
    side?: string;
    align?: string;
    sideOffset?: number;
  }) => <div {...props}>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Search: () => <span>search</span>,
}));

function makeConcept(overrides: Partial<Concept> = {}): Concept {
  return {
    id: 'graph-neural-networks',
    nameZh: '图神经网络',
    nameEn: 'Graph Neural Networks',
    definition: 'A neural architecture on graphs.',
    parentId: null,
    level: 0,
    maturity: 'working',
    searchKeywords: ['gnn', 'message passing'],
    history: [],
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ConceptSelector', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('searches by bilingual names and keywords and shows a user-facing label', () => {
    act(() => {
      root.render(
        <ConceptSelector
          open
          onOpenChange={() => {}}
          anchorRect={{ x: 10, y: 20 }}
          concepts={[
            makeConcept(),
            makeConcept({
              id: 'bayesian-models',
              nameZh: '贝叶斯模型',
              nameEn: 'Bayesian Models',
              searchKeywords: ['probabilistic'],
            }),
          ]}
          onSelect={() => {}}
          onCreateNew={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain('图神经网络');
    expect(container.textContent).toContain('Graph Neural Networks');
    expect(container.textContent).not.toContain('graph-neural-networks');

    const input = container.querySelector('input');
    expect(input).toBeTruthy();

    act(() => {
      setInputValue(input as HTMLInputElement, 'message passing');
    });

    expect(container.textContent).toContain('图神经网络');
    expect(container.textContent).not.toContain('贝叶斯模型');

    act(() => {
      setInputValue(input as HTMLInputElement, '贝叶斯');
    });

    expect(container.textContent).toContain('贝叶斯模型');
    expect(container.textContent).not.toContain('图神经网络');
  });
});