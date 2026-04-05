import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

import { registerMemosHandlers } from './memos-handler';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('registerMemosHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('upgrades memo to note with preserved associations and linked note relation', async () => {
    const memo = {
      id: 'memo-1',
      text: 'First paragraph\n\nSecond paragraph',
      paperIds: ['paper-1'],
      conceptIds: ['concept-1'],
      annotationId: null,
      outlineId: null,
      linkedNoteIds: [],
      tags: ['tag-1'],
      indexed: false,
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:00:00.000Z',
    };
    const getMemo = vi.fn(async () => memo);
    const createNote = vi.fn(async (note: any, _linkedChunks?: any, _links?: any) => undefined);
    const linkMemoToNote = vi.fn(async () => undefined);
    const enqueueDbChange = vi.fn();

    registerMemosHandlers({
      logger: makeLogger(),
      dbProxy: {
        getMemo,
        createNote,
        linkMemoToNote,
      },
      pushManager: {
        enqueueDbChange,
      },
    } as any);

    const upgradeToNote = registeredHandlers.get('db:memos:upgradeToNote');
    expect(upgradeToNote).toBeTruthy();

    const result = await upgradeToNote!({} as any, 'memo-1');

    expect(getMemo).toHaveBeenCalledWith('memo-1');
    expect(createNote).toHaveBeenCalledTimes(1);
    const createdNote = createNote.mock.calls[0]![0];
    expect(createdNote).toMatchObject({
      id: result.noteId,
      title: 'First paragraph  Second paragraph',
      linkedPaperIds: ['paper-1'],
      linkedConceptIds: ['concept-1'],
      tags: ['tag-1'],
    });
    expect(JSON.parse(createdNote.documentJson)).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
      ],
    });
    expect(linkMemoToNote).toHaveBeenCalledWith('memo-1', result.noteId);
    expect(enqueueDbChange).toHaveBeenCalledWith(['research_memos', 'chunks', 'chunks_vec', 'research_notes'], 'insert');
  });
});