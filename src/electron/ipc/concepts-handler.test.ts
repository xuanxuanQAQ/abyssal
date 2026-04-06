import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

import { registerConceptsHandlers } from './concepts-handler';

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
    id: 'concept-root',
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

describe('registerConceptsHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('maps real hierarchy depth into frontend concept levels', async () => {
    const root = makeConcept();
    const child = makeConcept({
      id: 'concept-child',
      nameZh: '子概念',
      nameEn: 'Child Concept',
      parentId: 'concept-root',
    });
    const grandchild = makeConcept({
      id: 'concept-grandchild',
      nameZh: '孙概念',
      nameEn: 'Grandchild Concept',
      parentId: 'concept-child',
    });

    registerConceptsHandlers({
      logger: makeLogger(),
      dbProxy: {
        getAllConcepts: vi.fn(async () => [root, child, grandchild]),
      },
    } as any);

    const listConcepts = registeredHandlers.get('db:concepts:list');
    expect(listConcepts).toBeTruthy();

    const result = await listConcepts!({} as any);
    expect(result).toEqual([
      expect.objectContaining({ id: 'concept-root', level: 0, description: 'Root definition', keywords: ['root'] }),
      expect.objectContaining({ id: 'concept-child', level: 1 }),
      expect.objectContaining({ id: 'concept-grandchild', level: 2 }),
    ]);
  });
});