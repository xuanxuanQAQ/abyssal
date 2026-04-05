import { beforeEach, describe, expect, it, vi } from 'vitest';

const startupState = vi.hoisted(() => {
  const mainWindow = {
    webContents: {
      on: vi.fn(),
    },
    show: vi.fn(),
  };

  return {
    appMock: {
      getPath: vi.fn((name: string) => (name === 'userData' ? 'C:/Users/xuanxuan/AppData/Roaming/Abyssal' : '')),
      isPackaged: false,
      quit: vi.fn(),
    },
    dialogMock: {
      showErrorBox: vi.fn(),
    },
    createMainWindowMock: vi.fn(() => mainWindow),
    registerAllHandlersMock: vi.fn(),
    setWindowMock: vi.fn(),
    mainWindow,
  };
});

vi.mock('electron', () => ({
  app: startupState.appMock,
  dialog: startupState.dialogMock,
}));

vi.mock('../../../src/electron/window-manager', () => ({
  createMainWindow: (...args: unknown[]) => startupState.createMainWindowMock(...args),
  getMainWindow: () => startupState.mainWindow,
}));

vi.mock('../../../src/electron/ipc/register', () => ({
  registerAllHandlers: (...args: unknown[]) => startupState.registerAllHandlersMock(...args),
}));

vi.mock('../../../src/electron/ipc/push', () => ({
  PushManager: class {
    setWindow = startupState.setWindowMock;
  },
}));

vi.mock('../../../src/core/infra/global-config', () => ({
  loadGlobalConfig: vi.fn(() => ({})),
}));

vi.mock('../../../src/core/workspace', () => ({
  WorkspaceManager: class {
    getRecentWorkspaces() {
      return [];
    }
  },
  isWorkspace: vi.fn(() => false),
  scaffoldWorkspace: vi.fn(),
  getWorkspacePaths: vi.fn(() => ({ logs: 'C:/logs' })),
}));

async function loadBootstrap() {
  vi.resetModules();
  const mod = await import('../../../src/electron/bootstrap');
  return mod.bootstrap;
}

describe('app startup smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'main.js'];
  });

  it('boots the minimal GUI startup chain in lobby mode with handlers, window, and push wiring', async () => {
    const bootstrap = await loadBootstrap();

    const appContext = await bootstrap();

    expect(startupState.registerAllHandlersMock).toHaveBeenCalledTimes(1);
    expect(startupState.registerAllHandlersMock).toHaveBeenCalledWith(appContext);
    expect(startupState.createMainWindowMock).toHaveBeenCalledTimes(1);
    expect(startupState.createMainWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      isDev: true,
    }));
    expect(startupState.setWindowMock).toHaveBeenCalledWith(startupState.mainWindow);
    expect(appContext.mainWindow).toBe(startupState.mainWindow);
    expect(appContext.pushManager).not.toBeNull();
    expect(startupState.dialogMock.showErrorBox).not.toHaveBeenCalled();
    expect(startupState.appMock.quit).not.toHaveBeenCalled();
  });
});