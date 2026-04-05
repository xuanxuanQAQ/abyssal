/**
 * Desktop E2E smoke — IPC roundtrip verification.
 *
 * Mocks Electron to verify: preload → IPC → push roundtrip,
 * window lifecycle, and workspace switch flow.
 */

const ipcState = vi.hoisted(() => {
  const handlers = new Map<string, Function>();
  const listeners = new Map<string, Function[]>();
  const sentMessages: Array<{ channel: string; data: unknown }> = [];

  return {
    handlers,
    listeners,
    sentMessages,
    mainWindow: {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn((channel: string, data: unknown) => {
          sentMessages.push({ channel, data });
        }),
        on: vi.fn(),
      },
      show: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      ipcState.handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: Function) => {
      const list = ipcState.listeners.get(channel) ?? [];
      list.push(handler);
      ipcState.listeners.set(channel, list);
    }),
    removeListener: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => 'C:/tmp/test-app-data'),
    isPackaged: false,
    quit: vi.fn(),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PushManager } from '../../../src/electron/ipc/push';
import { wrapHandler } from '../../../src/electron/ipc/register';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('IPC roundtrip smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcState.sentMessages.length = 0;
    ipcState.handlers.clear();
  });

  it('wrapHandler produces ok envelope for successful handler', async () => {
    const handler = wrapHandler(
      'test:echo',
      logger as any,
      async (_event, msg) => ({ echo: msg }),
    );

    const result = await handler({} as any, 'hello');

    expect(result).toEqual({
      ok: true,
      data: { echo: 'hello' },
    });
  });

  it('wrapHandler produces error envelope for failing handler', async () => {
    const handler = wrapHandler(
      'test:fail',
      logger as any,
      async () => { throw new Error('boom'); },
    );

    const result = await handler({} as any);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('boom');
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });

  it('PushManager delivers to window webContents', () => {
    const pm = new PushManager();
    pm.setWindow(ipcState.mainWindow as any);

    pm.pushNotification({ type: 'info', title: 'Test', message: 'Hello' });

    expect(ipcState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'push:notification',
      { type: 'info', title: 'Test', message: 'Hello' },
    );

    pm.destroy();
  });

  it('full request-response + push roundtrip', async () => {
    // 1. Register handler
    const handler = wrapHandler(
      'workspace:getInfo',
      logger as any,
      async () => ({ name: 'Test Workspace', paperCount: 5 }),
    );

    // 2. Simulate request
    const response = await handler({} as any);
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ name: 'Test Workspace', paperCount: 5 });

    // 3. Push notification
    const pm = new PushManager();
    pm.setWindow(ipcState.mainWindow as any);
    pm.pushNotification({ type: 'success', title: 'Done', message: 'Workspace loaded' });

    expect(ipcState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'push:notification',
      expect.objectContaining({ type: 'success', title: 'Done' }),
    );

    pm.destroy();
  });
});

describe('workspace switch desktop flow', () => {
  it('pushes workspace-switched event to renderer', () => {
    const pm = new PushManager();
    pm.setWindow(ipcState.mainWindow as any);

    pm.pushWorkspaceSwitched({ rootDir: 'C:/new-workspace', name: 'New WS' });

    expect(ipcState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'workspace:switched$event',
      { rootDir: 'C:/new-workspace', name: 'New WS' },
    );

    pm.destroy();
  });
});

describe('copilot event push flow', () => {
  it('pushes copilot events to renderer', () => {
    const pm = new PushManager();
    pm.setWindow(ipcState.mainWindow as any);

    pm.pushCopilotEvent({ type: 'operation.started', operationId: 'op-1' });
    pm.pushCopilotSessionChanged({ sessionId: 'sess-1', operationId: 'op-1' });

    expect(ipcState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'push:copilotEvent',
      expect.objectContaining({ type: 'operation.started' }),
    );
    expect(ipcState.mainWindow.webContents.send).toHaveBeenCalledWith(
      'push:copilotSessionChanged',
      expect.objectContaining({ sessionId: 'sess-1' }),
    );

    pm.destroy();
  });
});
