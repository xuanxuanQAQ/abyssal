import { beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, handlers, bootstrapMock, gracefulShutdownMock, parseCliArgsMock, batchRunMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const appMock = {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
      handlers.set(event, handler);
    }),
    quit: vi.fn(),
  };

  return {
    appMock,
    handlers,
    bootstrapMock: vi.fn(),
    gracefulShutdownMock: vi.fn(),
    parseCliArgsMock: vi.fn(),
    batchRunMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: appMock,
}));

vi.mock('./bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

vi.mock('./lifecycle', () => ({
  gracefulShutdown: (...args: unknown[]) => gracefulShutdownMock(...args),
}));

vi.mock('../cli/cli-entry', () => ({
  parseCliArgs: (...args: unknown[]) => parseCliArgsMock(...args),
}));

vi.mock('../cli/batch-runner', () => ({
  batchRun: (...args: unknown[]) => batchRunMock(...args),
}));

async function importMainWithArgv(argv: string[]): Promise<void> {
  vi.resetModules();
  handlers.clear();
  process.argv = argv;
  await import('./main');
  await flushAsyncWork();
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('electron main entry', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    process.argv = [...originalArgv];
    bootstrapMock.mockResolvedValue({
      isShuttingDown: false,
      mainWindow: { id: 'main-window' },
    });
    gracefulShutdownMock.mockResolvedValue(true);
    parseCliArgsMock.mockReturnValue({ stage: 'all' });
    batchRunMock.mockResolvedValue(undefined);
  });

  it('routes --batch startup through cli-entry and batch-runner without bootstrapping the GUI', async () => {
    await importMainWithArgv(['node', 'main.js', '--batch', '--stage', 'discover']);
    await flushAsyncWork();

    expect(parseCliArgsMock).toHaveBeenCalledWith(['node', 'main.js', '--batch', '--stage', 'discover']);
    expect(batchRunMock).toHaveBeenCalledWith({ stage: 'all' });
    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(appMock.whenReady).not.toHaveBeenCalled();
    expect(appMock.quit).toHaveBeenCalledTimes(1);
  });

  it('writes a fatal batch error to stderr and still quits the app', async () => {
    batchRunMock.mockRejectedValueOnce(new Error('batch failed hard'));
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await importMainWithArgv(['node', 'main.js', '--batch']);
    await flushAsyncWork();

    expect(stderrWrite).toHaveBeenCalledWith('Fatal: batch failed hard\n');
    expect(appMock.quit).toHaveBeenCalledTimes(1);
    expect(bootstrapMock).not.toHaveBeenCalled();

    stderrWrite.mockRestore();
  });

  it('boots the GUI once and guards before-quit against re-entrant shutdown', async () => {
    await importMainWithArgv(['node', 'main.js']);

    expect(appMock.whenReady).toHaveBeenCalledTimes(1);
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(handlers.has('window-all-closed')).toBe(true);
    expect(handlers.has('before-quit')).toBe(true);

    const beforeQuit = handlers.get('before-quit');
    expect(beforeQuit).toBeDefined();

    const event = { preventDefault: vi.fn() };
    await beforeQuit?.(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(gracefulShutdownMock).toHaveBeenCalledTimes(1);
    expect(appMock.quit).toHaveBeenCalledTimes(1);

    const shuttingDownCtx = {
      isShuttingDown: true,
      mainWindow: { id: 'main-window' },
    };
    bootstrapMock.mockResolvedValue(shuttingDownCtx);
    gracefulShutdownMock.mockClear();
    appMock.quit.mockClear();
    await importMainWithArgv(['node', 'main.js']);
    const secondBeforeQuit = handlers.get('before-quit');
    await secondBeforeQuit?.({ preventDefault: vi.fn() });
    expect(gracefulShutdownMock).not.toHaveBeenCalled();
    expect(appMock.quit).not.toHaveBeenCalled();
  });
});