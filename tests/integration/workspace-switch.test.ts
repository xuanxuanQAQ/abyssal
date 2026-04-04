import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigProvider } from '../../src/core/infra/config-provider';
import { loadGlobalConfig } from '../../src/core/infra/global-config';
import { ConfigLoader } from '../../src/core/infra/config';
import { WorkspaceManager, getWorkspacePaths, isWorkspace, scaffoldWorkspace } from '../../src/core/workspace';
import { acquireLock, type LockHandle } from '../../src/electron/lock';

const { appMock, dialogMock, registeredHandlers, createDbProxyMock } = vi.hoisted(() => ({
  appMock: {
    getPath: vi.fn<(name: string) => string>(),
  },
  dialogMock: {
    showOpenDialog: vi.fn(),
  },
  registeredHandlers: new Map<string, (...args: any[]) => Promise<any>>(),
  createDbProxyMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: appMock,
  dialog: dialogMock,
}));

vi.mock('../../src/electron/ipc/register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

vi.mock('../../src/db-process/db-proxy', () => ({
  createDbProxy: (...args: unknown[]) => createDbProxyMock(...args),
}));

import { registerWorkspaceHandlers } from '../../src/electron/ipc/workspace-handler';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('workspace switch integration', () => {
  const createdDirs: string[] = [];
  const acquiredLocks: LockHandle[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.clear();
    const appDataDir = makeTempDir('abyssal-workspace-switch-appdata-');
    createdDirs.push(appDataDir);
    appMock.getPath.mockImplementation((name: string) => {
      if (name === 'userData') {
        return appDataDir;
      }
      return os.tmpdir();
    });
  });

  afterEach(() => {
    for (const lock of acquiredLocks.splice(0)) {
      try {
        lock.release();
      } catch {
        // ignore cleanup failures
      }
    }

    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeContext(oldWorkspace: string) {
    const appDataDir = createdDirs[0]!;
    const config = ConfigLoader.loadFromWorkspace(oldWorkspace, loadGlobalConfig(appDataDir));
    const configProvider = new ConfigProvider(config);
    const oldLock = acquireLock(oldWorkspace);
    acquiredLocks.push(oldLock);

    const oldDbProxy = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const pushManager = {
      pushWorkspaceSwitched: vi.fn(),
    };

    const ctx = {
      logger: makeLogger(),
      dbProxy: oldDbProxy,
      lockHandle: oldLock,
      workspaceRoot: oldWorkspace,
      configProvider,
      get config() {
        return this.configProvider.config;
      },
      refreshFrameworkState: vi.fn().mockResolvedValue(undefined),
      pushManager,
    } as any;

    return { ctx, oldDbProxy, pushManager, configProvider };
  }

  it('switches to a new workspace by releasing old resources, starting a new db proxy, and notifying renderer', async () => {
    const rootParent = makeTempDir('abyssal-workspace-switch-root-');
    createdDirs.push(rootParent);
    const oldWorkspace = path.join(rootParent, 'old-workspace');
    const newWorkspace = path.join(rootParent, 'new-workspace');

    scaffoldWorkspace({ rootDir: oldWorkspace, name: 'Old Workspace' });
    const { ctx, oldDbProxy, pushManager } = makeContext(oldWorkspace);

    const newDbProxy = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    createDbProxyMock.mockReturnValue(newDbProxy);

    registerWorkspaceHandlers(ctx);

    const switchHandler = registeredHandlers.get('workspace:switch');
    const getCurrentHandler = registeredHandlers.get('workspace:getCurrent');
    const listRecentHandler = registeredHandlers.get('workspace:listRecent');

    expect(switchHandler).toBeDefined();
    expect(getCurrentHandler).toBeDefined();
    expect(listRecentHandler).toBeDefined();

    await switchHandler!({} as any, newWorkspace);
    acquiredLocks.push(ctx.lockHandle);

    const current = await getCurrentHandler!({} as any);
    const recent = await listRecentHandler!({} as any);

    expect(oldDbProxy.close).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(oldWorkspace, '.lock'))).toBe(false);
    expect(isWorkspace(newWorkspace)).toBe(true);
    expect(fs.existsSync(path.join(newWorkspace, '.lock'))).toBe(true);
    expect(createDbProxyMock).toHaveBeenCalledTimes(1);
    expect(newDbProxy.start).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: newWorkspace,
      userDataPath: createdDirs[0],
      skipVecExtension: false,
    }));
    expect(ctx.workspaceRoot).toBe(newWorkspace);
    expect(ctx.dbProxy).toBe(newDbProxy);
    expect(ctx.refreshFrameworkState).toHaveBeenCalledTimes(1);
    expect(pushManager.pushWorkspaceSwitched).toHaveBeenCalledWith({
      rootDir: newWorkspace,
      name: 'new-workspace',
    });
    expect(current).toMatchObject({
      rootDir: newWorkspace,
      name: 'new-workspace',
      paths: getWorkspacePaths(newWorkspace),
    });
    expect(recent[0]).toMatchObject({
      path: path.resolve(newWorkspace),
      name: 'new-workspace',
    });
  });

  it('continues switching when the previous db proxy close fails and scaffolds a missing target workspace', async () => {
    const rootParent = makeTempDir('abyssal-workspace-switch-root-');
    createdDirs.push(rootParent);
    const oldWorkspace = path.join(rootParent, 'old-workspace');
    const newWorkspace = path.join(rootParent, 'brand-new-workspace');

    scaffoldWorkspace({ rootDir: oldWorkspace, name: 'Old Workspace' });
    const { ctx } = makeContext(oldWorkspace);
    ctx.dbProxy.close.mockRejectedValueOnce(new Error('close failed'));

    const newDbProxy = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    createDbProxyMock.mockReturnValue(newDbProxy);

    registerWorkspaceHandlers(ctx);
    const switchHandler = registeredHandlers.get('workspace:switch');

    await expect(switchHandler!({} as any, newWorkspace)).resolves.toBeUndefined();
    acquiredLocks.push(ctx.lockHandle);

    expect(isWorkspace(newWorkspace)).toBe(true);
    expect(ctx.workspaceRoot).toBe(newWorkspace);
    expect(ctx.config.project.name).toBe('brand-new-workspace');
    expect(newDbProxy.start).toHaveBeenCalledTimes(1);
    expect(ctx.refreshFrameworkState).toHaveBeenCalledTimes(1);
  });

  it('updates the recent workspace list after switching', async () => {
    const rootParent = makeTempDir('abyssal-workspace-switch-root-');
    createdDirs.push(rootParent);
    const oldWorkspace = path.join(rootParent, 'old-workspace');
    const newWorkspace = path.join(rootParent, 'new-workspace');

    scaffoldWorkspace({ rootDir: oldWorkspace, name: 'Old Workspace' });
    const { ctx } = makeContext(oldWorkspace);

    const newDbProxy = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    createDbProxyMock.mockReturnValue(newDbProxy);

    registerWorkspaceHandlers(ctx);
    await registeredHandlers.get('workspace:switch')!({} as any, newWorkspace);
    acquiredLocks.push(ctx.lockHandle);

    const manager = new WorkspaceManager(createdDirs[0]!);
    const recent = manager.getRecentWorkspaces();

    expect(recent.map((entry) => entry.path)).toContain(path.resolve(newWorkspace));
    expect(recent[0]?.path).toBe(path.resolve(newWorkspace));
  });

  it('rolls back to the previous workspace when the new db proxy fails to start', async () => {
    const rootParent = makeTempDir('abyssal-workspace-switch-root-');
    createdDirs.push(rootParent);
    const oldWorkspace = path.join(rootParent, 'old-workspace');
    const newWorkspace = path.join(rootParent, 'new-workspace');

    scaffoldWorkspace({ rootDir: oldWorkspace, name: 'Old Workspace' });
    const { ctx, oldDbProxy, pushManager, configProvider } = makeContext(oldWorkspace);
    const previousConfig = configProvider.config;

    const failedProxy = {
      start: vi.fn().mockRejectedValue(new Error('db startup failed')),
      close: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    createDbProxyMock.mockReturnValue(failedProxy);

    registerWorkspaceHandlers(ctx);

    await expect(registeredHandlers.get('workspace:switch')!({} as any, newWorkspace)).rejects.toThrow('db startup failed');

    expect(oldDbProxy.close).not.toHaveBeenCalled();
    expect(ctx.workspaceRoot).toBe(oldWorkspace);
    expect(ctx.dbProxy).toBe(oldDbProxy);
    expect(ctx.lockHandle).toBeDefined();
    expect(fs.existsSync(path.join(oldWorkspace, '.lock'))).toBe(true);
    expect(fs.existsSync(path.join(newWorkspace, '.lock'))).toBe(false);
    expect(configProvider.config).toBe(previousConfig);
    expect(ctx.refreshFrameworkState).not.toHaveBeenCalled();
    expect(pushManager.pushWorkspaceSwitched).not.toHaveBeenCalled();
  });
});