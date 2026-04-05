/**
 * Robustness tests — IPC register wrapHandler under protocol violations.
 *
 * Tests: sanitization edge cases, concurrent handlers, and error classification.
 */
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wrapHandler } from '../../../src/electron/ipc/register';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('wrapHandler robustness — protocol violations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes circular references without crashing', async () => {
    const handler = wrapHandler(
      'test:circular',
      logger as any,
      async () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        return obj;
      },
    );

    // Should not throw even with circular reference
    // (sanitizeForIPC uses WeakMap cache to handle cycles)
    const result = await handler({} as any);
    expect(result.ok).toBe(true);
  });

  it('sanitizes Date to ISO string', async () => {
    const handler = wrapHandler(
      'test:date',
      logger as any,
      async () => ({ created: new Date('2024-06-01T12:00:00Z') }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    expect((result.data as any).created).toBe('2024-06-01T12:00:00.000Z');
  });

  it('sanitizes Map to plain object', async () => {
    const handler = wrapHandler(
      'test:map',
      logger as any,
      async () => ({ data: new Map([['key1', 'val1'], ['key2', 'val2']]) }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    expect((result.data as any).data).toEqual({ key1: 'val1', key2: 'val2' });
  });

  it('sanitizes Set to array', async () => {
    const handler = wrapHandler(
      'test:set',
      logger as any,
      async () => ({ items: new Set([1, 2, 3]) }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    expect((result.data as any).items).toEqual([1, 2, 3]);
  });

  it('sanitizes Float32Array to regular array', async () => {
    const handler = wrapHandler(
      'test:typed-array',
      logger as any,
      async () => ({ embedding: new Float32Array([0.1, 0.2, 0.3]) }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    // Float32Array has lower precision than Float64 — use arrayContaining with closeTo
    const arr = (result.data as any).embedding;
    expect(arr).toHaveLength(3);
    expect(arr[0]).toBeCloseTo(0.1, 5);
    expect(arr[1]).toBeCloseTo(0.2, 5);
    expect(arr[2]).toBeCloseTo(0.3, 5);
  });

  it('preserves Uint8Array for Structured Clone', async () => {
    const handler = wrapHandler(
      'test:uint8',
      logger as any,
      async () => ({ binary: new Uint8Array([1, 2, 3]) }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    expect((result.data as any).binary).toBeInstanceOf(Uint8Array);
  });

  it('strips undefined values (JSON semantics)', async () => {
    const handler = wrapHandler(
      'test:undefined',
      logger as any,
      async () => ({ a: 1, b: undefined, c: 'yes' }),
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ a: 1, c: 'yes' });
    expect('b' in (result.data as any)).toBe(false);
  });

  it('handles null and primitive returns', async () => {
    const nullHandler = wrapHandler('test:null', logger as any, async () => null);
    const numHandler = wrapHandler('test:num', logger as any, async () => 42);
    const strHandler = wrapHandler('test:str', logger as any, async () => 'hello');

    expect((await nullHandler({} as any)).data).toBeNull();
    expect((await numHandler({} as any)).data).toBe(42);
    expect((await strHandler({} as any)).data).toBe('hello');
  });

  it('logs entry and response timing', async () => {
    const handler = wrapHandler(
      'test:logging',
      logger as any,
      async () => 'result',
    );

    await handler({} as any);

    expect(logger.debug).toHaveBeenCalledWith(
      'IPC call: test:logging',
      expect.any(Object),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'IPC response: test:logging',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
  });

  it('classifies AbyssalError with code and recoverable flag', async () => {
    const abyssalError = new Error('Custom error') as any;
    abyssalError.code = 'PAPER_NOT_FOUND';
    abyssalError.recoverable = true;
    abyssalError.context = { paperId: 'p1' };
    abyssalError.__abyssal = true;

    // We need to mock the AbyssalError.isAbyssalError check
    // Since the actual implementation checks for a specific property,
    // let's just test with a plain error that has code/recoverable
    const handler = wrapHandler(
      'test:custom-error',
      logger as any,
      async () => { throw abyssalError; },
    );

    const result = await handler({} as any);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('PAPER_NOT_FOUND');
    expect(result.error?.recoverable).toBe(true);
  });

  it('timeout produces IPC_TIMEOUT error code', async () => {
    vi.useFakeTimers();
    try {
      const handler = wrapHandler(
        'test:timeout',
        logger as any,
        async () => new Promise<never>(() => {}), // Never resolves
        { timeoutMs: 100 },
      );

      const promise = handler({} as any);
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('IPC_TIMEOUT');
      expect(result.error?.recoverable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
