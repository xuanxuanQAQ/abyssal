import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function makeTempWorkspace(): string {
  const dir = path.join(os.tmpdir(), `abyssal-smoke-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure in temp workspace
    }
  }
  tempDirs.length = 0;
  vi.restoreAllMocks();
});

describe('workspace lock smoke', () => {
  it('surfaces a diagnostic conflict payload when a live lock cannot be probed', async () => {
    const workspace = makeTempWorkspace();
    tempDirs.push(workspace);
    const lockPath = path.join(workspace, '.lock');

    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 4242,
      startedAt: '2026-04-05T12:00:00.000Z',
      electronVersion: '41.1.0',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    }));

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        renameSync: () => {
          const error = new Error('busy') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        },
      };
    });

    const { acquireLock, LockError } = await import('../../../src/electron/lock');

    let thrown: unknown;
    try {
      acquireLock(workspace);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LockError);
    expect((thrown as LockError).pid).toBe(4242);
    expect((thrown as LockError).startedAt).toBe('2026-04-05T12:00:00.000Z');
    expect((thrown as Error).message).toContain('PID: 4242');
  });

  it('can reacquire the workspace after a prior holder releases it', async () => {
    const workspace = makeTempWorkspace();
    tempDirs.push(workspace);

    vi.resetModules();
    vi.doUnmock('node:fs');
    const { acquireLock } = await import('../../../src/electron/lock');

    const firstHandle = acquireLock(workspace);
    firstHandle.release();

    const secondHandle = acquireLock(workspace);
    expect(fs.existsSync(path.join(workspace, '.lock'))).toBe(true);
    secondHandle.release();
    expect(fs.existsSync(path.join(workspace, '.lock'))).toBe(false);
  });
});