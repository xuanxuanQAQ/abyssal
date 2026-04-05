import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConceptTreeNode } from './ConceptTreeNode';

const useConceptStatsMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'analysis.concepts.tree.mappingSummary') {
        return `${params?.['mappingCount']} mappings, ${params?.['paperCount']} papers, ${params?.['reviewedCount']} reviewed (${params?.['reviewedPct']}%)`;
      }
      return key;
    },
  }),
}));

vi.mock('../../../../core/ipc/hooks/useConcepts', () => ({
  useConceptStats: () => useConceptStatsMock(),
}));

vi.mock('../../../../shared/MaturityBadge', () => ({
  MaturityBadge: () => <span data-testid="maturity-badge" />,
}));

describe('ConceptTreeNode', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    useConceptStatsMock.mockReturnValue({
      data: {
        conceptId: 'c-1',
        mappingCount: 6,
        paperCount: 3,
        avgConfidence: 0.5,
        relationDistribution: {},
        reviewedCount: 2,
        unreviewedCount: 4,
      },
    });
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

  it('describes reviewed progress instead of paper-to-mapping ratio', () => {
    act(() => {
      root.render(
        <ul>
          <ConceptTreeNode
            node={{
              concept: {
                id: 'c-1',
                name: 'Concept One',
                nameZh: '概念一',
                nameEn: 'Concept One',
                description: '',
                parentId: null,
                level: 0,
                maturity: 'working',
                keywords: [],
                history: [],
              },
              children: [],
            }}
            depth={0}
            selectedId={null}
            onSelect={() => {}}
          />
        </ul>,
      );
    });

    const summary = container.querySelector('[title]');
    expect(summary?.getAttribute('title')).toBe('6 mappings, 3 papers, 2 reviewed (33%)');
  });
});