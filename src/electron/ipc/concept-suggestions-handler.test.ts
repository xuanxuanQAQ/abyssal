import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

import { registerConceptSuggestionsHandlers } from './concept-suggestions-handler';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeConcept(overrides: Record<string, unknown> = {}) {
  return {
    id: 'concept_root',
    nameZh: '根概念',
    nameEn: 'Root Concept',
    layer: 'root',
    definition: 'Root definition',
    searchKeywords: ['root'],
    maturity: 'working',
    parentId: null,
    history: [],
    deprecated: false,
    deprecatedAt: null,
    deprecatedReason: null,
    createdAt: '2026-04-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerConceptSuggestionsHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('returns frontend concept shape when adopting a suggestion', async () => {
    const adoptSuggestedConcept = vi.fn(async () => 'concept_child');
    const getAllConcepts = vi.fn(async () => [
      makeConcept(),
      makeConcept({
        id: 'concept_child',
        nameZh: '图神经网络',
        nameEn: 'Graph Neural Networks',
        definition: 'A neural architecture on graphs.',
        searchKeywords: ['gnn', 'message passing'],
        maturity: 'tentative',
        parentId: 'concept_root',
      }),
    ]);
    const refreshFrameworkState = vi.fn(async () => undefined);
    const enqueueDbChange = vi.fn();

    registerConceptSuggestionsHandlers({
      logger: makeLogger(),
      dbProxy: {
        adoptSuggestedConcept,
        getAllConcepts,
      },
      refreshFrameworkState,
      pushManager: {
        enqueueDbChange,
      },
    } as any);

    const acceptSuggestion = registeredHandlers.get('db:suggestedConcepts:accept');
    expect(acceptSuggestion).toBeTruthy();

    const result = await acceptSuggestion!({} as any, 12, {
      nameZh: '图神经网络',
      nameEn: 'Graph Neural Networks',
      definition: 'A neural architecture on graphs.',
      keywords: ['gnn', 'message passing'],
      parentId: 'concept_root',
    });

    expect(adoptSuggestedConcept).toHaveBeenCalledWith(12, {
      nameZh: '图神经网络',
      nameEn: 'Graph Neural Networks',
      definition: 'A neural architecture on graphs.',
      searchKeywords: ['gnn', 'message passing'],
      parentId: 'concept_root',
    });
    expect(refreshFrameworkState).toHaveBeenCalledTimes(1);
    expect(enqueueDbChange).toHaveBeenCalledWith(['concepts', 'suggested_concepts'], 'insert');
    expect(result).toEqual(expect.objectContaining({
      id: 'concept_child',
      name: 'Graph Neural Networks',
      nameZh: '图神经网络',
      nameEn: 'Graph Neural Networks',
      description: 'A neural architecture on graphs.',
      keywords: ['gnn', 'message passing'],
      level: 1,
      parentId: 'concept_root',
      history: [],
    }));
  });
});