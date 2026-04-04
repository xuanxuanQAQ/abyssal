import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('./papers-handler', () => ({ registerPapersHandlers: vi.fn() }));
vi.mock('./search-handler', () => ({ registerSearchHandlers: vi.fn() }));
vi.mock('./acquire-handler', () => ({ registerAcquireHandlers: vi.fn() }));
vi.mock('./concepts-handler', () => ({ registerConceptsHandlers: vi.fn() }));
vi.mock('./mappings-handler', () => ({ registerMappingsHandlers: vi.fn() }));
vi.mock('./annotations-handler', () => ({ registerAnnotationsHandlers: vi.fn() }));
vi.mock('./rag-handler', () => ({ registerRagHandlers: vi.fn() }));
vi.mock('./agent-handler', () => ({ registerChatPersistenceHandlers: vi.fn() }));
vi.mock('./copilot-handler', () => ({ registerCopilotHandlers: vi.fn() }));
vi.mock('./articles-handler', () => ({ registerArticlesHandlers: vi.fn() }));
vi.mock('./snapshots-handler', () => ({ registerSnapshotsHandlers: vi.fn() }));
vi.mock('./advisory-handler', () => ({ registerAdvisoryHandlers: vi.fn() }));
vi.mock('./memos-handler', () => ({ registerMemosHandlers: vi.fn() }));
vi.mock('./notes-handler', () => ({ registerNotesHandlers: vi.fn() }));
vi.mock('./concept-suggestions-handler', () => ({ registerConceptSuggestionsHandlers: vi.fn() }));
vi.mock('./settings-handler', () => ({ registerSettingsHandlers: vi.fn() }));
vi.mock('./system-handler', () => ({ registerSystemHandlers: vi.fn() }));
vi.mock('./tags-handler', () => ({ registerTagsHandlers: vi.fn() }));
vi.mock('./window-handler', () => ({ registerWindowHandlers: vi.fn() }));
vi.mock('./workspace-handler', () => ({ registerWorkspaceHandlers: vi.fn() }));
vi.mock('./dla-handler', () => ({ registerDlaHandlers: vi.fn() }));

import { wrapHandler } from './register';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('wrapHandler robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes structured-clone-unsafe values', async () => {
    const handler = wrapHandler(
      'test:channel',
      logger as any,
      async () => ({
        when: new Date('2024-01-01T00:00:00.000Z'),
        map: new Map([['a', 1]]),
        set: new Set([1, 2]),
        typed: new Float32Array([1.5, 2.5]),
        bytes: new Uint8Array([1, 2]),
      }),
    );

    const result = await handler({} as Electron.IpcMainInvokeEvent);

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      when: '2024-01-01T00:00:00.000Z',
      map: { a: 1 },
      set: [1, 2],
      typed: [1.5, 2.5],
    });
    expect((result.data as any).bytes).toBeInstanceOf(Uint8Array);
  });

  it('returns IPC_TIMEOUT envelope when handler exceeds timeout', async () => {
    vi.useFakeTimers();
    try {
      const handler = wrapHandler(
        'test:timeout',
        logger as any,
        async () => await new Promise<never>(() => {}),
        { timeoutMs: 5 },
      );

      const promise = handler({} as Electron.IpcMainInvokeEvent);
      await vi.advanceTimersByTimeAsync(10);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: 'IPC_TIMEOUT',
        recoverable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves code, recoverable and context for unexpected errors', async () => {
    const error = Object.assign(new Error('kaput'), {
      code: 'BROKEN_HANDLER',
      recoverable: true,
      context: { stage: 'unit-test' },
    });
    const handler = wrapHandler(
      'test:error',
      logger as any,
      async () => { throw error; },
    );

    const result = await handler({} as Electron.IpcMainInvokeEvent);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: 'BROKEN_HANDLER',
      message: 'kaput',
      recoverable: true,
      context: { stage: 'unit-test' },
    });
  });
});