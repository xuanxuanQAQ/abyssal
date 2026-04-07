import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gracefulShutdown } from '../../../src/electron/lifecycle';

describe('shutdown resources smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('flushes subprocess, database, and lock resources without leaving half-state handles', async () => {
    const terminate = vi.fn();
    const workerThread = {
      exitCode: null,
      postMessage: vi.fn(),
      once: vi.fn(),
      terminate,
    };
    const ctx = {
      isShuttingDown: false,
      activeWorkflows: new Map(),
      workerThread,
      dlaProxy: {
        shutdown: vi.fn(async () => {}),
      },
      session: null,
      sessionOrchestrator: null,
      dbProxy: {
        walCheckpoint: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      },
      ragRuntime: {
        close: vi.fn(async () => {}),
      },
      lockHandle: {
        release: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      mainWindow: null,
    };

    const shutdownPromise = gracefulShutdown(ctx as any, null);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(shutdownPromise).resolves.toBe(true);
    expect(workerThread.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(ctx.dlaProxy.shutdown).toHaveBeenCalledTimes(1);
    expect(ctx.dbProxy.walCheckpoint).toHaveBeenCalledTimes(1);
    expect(ctx.dbProxy.close).toHaveBeenCalledTimes(1);
    expect(ctx.ragRuntime.close).toHaveBeenCalledTimes(1);
    expect(ctx.lockHandle.release).toHaveBeenCalledTimes(1);
    expect(ctx.logger.info).toHaveBeenCalledWith('Application shut down gracefully');

    vi.useRealTimers();
  });
});