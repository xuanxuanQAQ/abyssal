import { fork } from 'node:child_process';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('db-process lifecycle', () => {
  const children = new Set<ReturnType<typeof fork>>();

  afterEach(async () => {
    await Promise.allSettled(Array.from(children, async (child) => {
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL');
      }
      await onceExit(child);
    }));
    children.clear();
  });

  it('exits when the parent IPC channel disconnects', async () => {
    const child = fork(
      path.resolve(__dirname, '..', '..', 'src', 'db-process', 'main.ts'),
      [],
      {
        execPath: process.execPath,
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    children.add(child);

    const ready = onceLifecycleReady(child);
    const exit = onceExit(child);

    await ready;
    child.disconnect();

    const result = await exit;
    expect(result.signal).toBe(null);
    expect(result.code).toBe(0);
  });
});

function onceLifecycleReady(child: ReturnType<typeof fork>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      const payload = message as { type?: string; action?: string; success?: boolean };
      if (payload.type === 'lifecycle' && payload.action === 'ready' && payload.success) {
        cleanup();
        resolve();
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Child exited before ready: code=${code}, signal=${signal}`));
    };

    const cleanup = () => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function onceExit(child: ReturnType<typeof fork>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: null });
  }

  return new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
}