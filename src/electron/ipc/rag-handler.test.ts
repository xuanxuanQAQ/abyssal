import { describe, expect, it, vi, beforeEach } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

import { registerRagHandlers } from './rag-handler';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('registerRagHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('builds writing context from outline/article metadata and retrieval', async () => {
    const searchSemantic = vi.fn(async () => []);
    const retrieve = vi.fn(async () => ({
      chunks: [
        {
          chunkId: 'ck1',
          paperId: 'p1',
          displayTitle: 'Paper One',
          text: 'evidence text',
          score: 0.91,
          pageStart: 2,
          originPath: 'rag',
        },
      ],
    }));

    const ctx = {
      logger: makeLogger(),
      ragModule: { searchSemantic, retrieve },
      workspaceRoot: 'C:/workspace',
      dbProxy: {
        getOutlineEntry: vi.fn(async () => ({
          id: 's2',
          articleId: 'a1',
          sortOrder: 2,
          title: 'Method',
          coreArgument: 'core thesis',
          writingInstruction: 'focus on evaluation',
          conceptIds: ['c1'],
          paperIds: ['p1'],
        })),
        getArticle: vi.fn(async () => ({ id: 'a1', title: 'Test Article' })),
        getOutline: vi.fn(async () => ([
          { id: 's1', sortOrder: 1, title: 'Intro' },
          { id: 's2', sortOrder: 2, title: 'Method' },
          { id: 's3', sortOrder: 3, title: 'Result' },
        ])),
        getSectionDrafts: vi.fn(async () => [{ version: 2, content: 'intro content for summary' }]),
        queryNotes: vi.fn(async () => [{ id: 'n1', title: 'related private note' }]),
      },
    } as any;

    registerRagHandlers(ctx);

    const handler = registeredHandlers.get('rag:getWritingContext');
    const result = await handler!({} as any, 's2');

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'article',
      conceptIds: ['c1'],
      paperIds: ['p1'],
      topK: 10,
    }));
    expect(searchSemantic).not.toHaveBeenCalled();

    expect(result.followingSectionTitles).toEqual(['Result']);
    expect(result.precedingSummary).toContain('Intro');
    expect(result.privateKBMatches).toEqual([
      { docId: 'n1', text: 'related private note', score: 0.5 },
    ]);
    expect(result.ragPassages).toHaveLength(1);
  });

  it('falls back to semantic search when retrieve fails', async () => {
    const searchSemantic = vi.fn(async () => [
      {
        chunkId: 'ck2',
        paperId: 'p2',
        displayTitle: 'Fallback Paper',
        text: 'fallback text',
        score: 0.66,
        pageStart: 1,
        originPath: 'rag',
      },
    ]);

    const ctx = {
      logger: makeLogger(),
      ragModule: {
        retrieve: vi.fn(async () => { throw new Error('retrieve failed'); }),
        searchSemantic,
      },
      workspaceRoot: 'C:/workspace',
      dbProxy: {
        getOutlineEntry: vi.fn(async () => null),
        getArticle: vi.fn(async () => null),
        getOutline: vi.fn(async () => []),
        getSectionDrafts: vi.fn(async () => []),
        queryNotes: vi.fn(async () => []),
      },
    } as any;

    registerRagHandlers(ctx);

    const handler = registeredHandlers.get('rag:getWritingContext');
    const result = await handler!({} as any, 'section-x');

    expect(searchSemantic).toHaveBeenCalledTimes(1);
    expect(result.ragPassages).toHaveLength(1);
  });

  it('prefers live document continuity when request carries documentJson', async () => {
    const retrieve = vi.fn(async () => ({ chunks: [] }));
    const searchSemantic = vi.fn(async () => []);

    const ctx = {
      logger: makeLogger(),
      ragModule: { retrieve, searchSemantic },
      workspaceRoot: 'C:/workspace',
      dbProxy: {
        getOutlineEntry: vi.fn(async () => ({
          id: 's2',
          articleId: 'a1',
          sortOrder: 2,
          title: 'Persisted Method',
          coreArgument: 'persisted argument',
          writingInstruction: 'persisted instruction',
          conceptIds: ['c1'],
          paperIds: ['p1'],
        })),
        getArticle: vi.fn(async () => ({ id: 'a1', title: 'Article Title' })),
        getOutline: vi.fn(async () => ([
          { id: 's1', sortOrder: 1, title: 'Persisted Intro' },
          { id: 's2', sortOrder: 2, title: 'Persisted Method' },
          { id: 's3', sortOrder: 3, title: 'Persisted Result' },
        ])),
        getSectionDrafts: vi.fn(async () => [{ version: 1, content: 'persisted intro body' }]),
        queryNotes: vi.fn(async () => []),
      },
    } as any;

    registerRagHandlers(ctx);

    const handler = registeredHandlers.get('rag:getWritingContext');
    const result = await handler!({} as any, {
      articleId: 'a1',
      sectionId: 's2',
      mode: 'article',
      documentJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1, sectionId: 's1' }, content: [{ type: 'text', text: 'Live Intro' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Live intro summary with unsaved edits.' }] },
          { type: 'heading', attrs: { level: 1, sectionId: 's2' }, content: [{ type: 'text', text: 'Live Method' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Live method body.' }] },
          { type: 'heading', attrs: { level: 1, sectionId: 's3' }, content: [{ type: 'text', text: 'Live Result' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Live result body.' }] },
        ],
      }),
    });

    expect(result.precedingSummary).toContain('Live Intro');
    expect(result.precedingSummary).toContain('unsaved edits');
    expect(result.followingSectionTitles).toEqual(['Live Result']);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      queryText: expect.stringContaining('Live Method'),
    }));
  });
});
