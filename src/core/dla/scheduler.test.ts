import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DlaScheduler } from './scheduler';

class MockDlaProxy extends EventEmitter {
  initialized = true;
  detectCalls: number[][] = [];
  private resolvers: Array<() => void> = [];

  detect = vi.fn(async (_pdfPath: string, pageIndices: number[]) => {
    this.detectCalls.push([...pageIndices]);
    await new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  });

  start = vi.fn(async () => {
    this.initialized = true;
    this.emit('ready');
  });

  resolveNext(): void {
    const resolve = this.resolvers.shift();
    resolve?.();
  }
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
} as any;

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DlaScheduler', () => {
  it('uses single-page batches for background full-document analysis', async () => {
    const proxy = new MockDlaProxy();
    const scheduler = new DlaScheduler(proxy as any, logger);

    scheduler.requestFullDocument('paper-1', '/tmp/paper.pdf', 3);
    expect(proxy.detectCalls).toEqual([[0]]);

    proxy.resolveNext();
    await flushMicrotasks();
    expect(proxy.detectCalls).toEqual([[0], [1]]);

    proxy.resolveNext();
    await flushMicrotasks();
    expect(proxy.detectCalls).toEqual([[0], [1], [2]]);
  });

  it('runs newly queued high-priority pages before remaining background pages', async () => {
    const proxy = new MockDlaProxy();
    const scheduler = new DlaScheduler(proxy as any, logger);

    scheduler.requestFullDocument('paper-2', '/tmp/paper.pdf', 4);
    expect(proxy.detectCalls).toEqual([[0]]);

    scheduler.requestPages('paper-2', '/tmp/paper.pdf', [3], 0);

    proxy.resolveNext();
    await flushMicrotasks();
    expect(proxy.detectCalls).toEqual([[0], [3]]);
  });
});