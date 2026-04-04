import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DbProxy } from '../../src/db-process/db-proxy';

class FakeChild extends EventEmitter {
  sentMessages: unknown[] = [];

  send(message: unknown): void {
    this.sentMessages.push(message);
  }

  kill(): void {}
}

describe('db-process rpc integration surface', () => {
  it('serializes Float32Array arguments into the outbound RPC envelope', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new FakeChild();
    (proxy as any).child = child;
    (proxy as any).setupMessageHandler();

    const callPromise = proxy.call('searchEmbeddings', new Float32Array([1.5, 2.5]));
    const request = child.sentMessages[0] as {
      id: string;
      method: string;
      args: Array<{ __type: string; data: number[] }>;
    };

    expect(request.method).toBe('searchEmbeddings');
    expect(request.args[0]).toEqual({
      __type: 'Float32Array',
      data: [1.5, 2.5],
    });

    child.emit('message', { id: request.id, result: { ok: true } });
    await expect(callPromise).resolves.toEqual({ ok: true });
  });

  it('restores structured results and preserves remote error metadata in RPC responses', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new FakeChild();
    (proxy as any).child = child;
    (proxy as any).setupMessageHandler();

    const okPromise = proxy.call('getStats');
    const okRequest = child.sentMessages[0] as { id: string };
    child.emit('message', {
      id: okRequest.id,
      result: {
        setValue: { __type: 'Set', data: ['a', 'b'] },
        mapValue: { __type: 'Map', data: [['x', 1]] },
        embedding: { __type: 'Float32Array', data: [0.1, 0.2] },
      },
    });

    await expect(okPromise).resolves.toMatchObject({
      setValue: new Set(['a', 'b']),
      mapValue: new Map([['x', 1]]),
      embedding: new Float32Array([0.1, 0.2]),
    });

    const errorPromise = proxy.call('getPaper', 'missing-paper');
    const errorRequest = child.sentMessages[1] as { id: string };
    child.emit('message', {
      id: errorRequest.id,
      error: {
        message: 'paper missing',
        code: 'PAPER_NOT_FOUND',
        name: 'AbyssalError',
        context: { paperId: 'missing-paper' },
      },
    });

    await expect(errorPromise).rejects.toMatchObject({
      message: 'paper missing',
      code: 'PAPER_NOT_FOUND',
      context: { paperId: 'missing-paper' },
    });
  });

  it('rejects pending RPC calls when the child process crashes mid-flight', async () => {
    const proxy = new DbProxy({ timeoutMs: 1000 });
    const child = new FakeChild();
    (proxy as any).child = child;
    (proxy as any).setupMessageHandler();

    const pendingPromise = proxy.call('getStats');
    expect((proxy as any).pending.size).toBe(1);

    (proxy as any).handleChildCrash(new Error('subprocess crashed'));

    await expect(pendingPromise).rejects.toThrow('DB subprocess crashed: subprocess crashed');
    expect((proxy as any).pending.size).toBe(0);
  });

  it('times out stalled RPC calls and clears pending entries', async () => {
    vi.useFakeTimers();
    try {
      const proxy = new DbProxy({ timeoutMs: 25 });
      const child = new FakeChild();
      (proxy as any).child = child;
      (proxy as any).setupMessageHandler();

      const promise = proxy.call('getStats');
      const captured = promise.then(
        () => ({ ok: true as const }),
        (error) => error as Error,
      );
      expect((proxy as any).pending.size).toBe(1);

      await vi.advanceTimersByTimeAsync(26);

      await expect(captured).resolves.toMatchObject({ message: 'RPC timeout: getStats (25ms)' });
      expect((proxy as any).pending.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});