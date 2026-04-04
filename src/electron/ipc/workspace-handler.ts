/**
 * IPC handler: workspace namespace
 *
 * Contract channels: workspace:create, workspace:openDialog, workspace:listRecent,
 *   workspace:getCurrent, workspace:switch, workspace:removeRecent, workspace:togglePin,
 *   app:switchProject, app:listProjects, app:createProject
 */

import { dialog, app } from 'electron';
import * as path from 'node:path';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { acquireLock } from '../lock';
import { ConfigLoader } from '../../core/infra/config';
import { loadGlobalConfig } from '../../core/infra/global-config';
import { createDbProxy } from '../../db-process/db-proxy';
import {
  WorkspaceManager,
  scaffoldWorkspace,
  isWorkspace,
  getWorkspacePaths,
} from '../../core/workspace';

export function registerWorkspaceHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  // ── workspace:create ──

  typedHandler('workspace:create', logger, async (_e, opts) => {
    const result = scaffoldWorkspace({
      rootDir: opts.rootDir,
      name: opts.name ?? 'Untitled',
      description: opts.description ?? '',
    });
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.touchRecent(opts.rootDir, opts.name ?? 'Untitled');
    return result as any;
  });

  // ── workspace:openDialog ──

  typedHandler('workspace:openDialog', logger, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Abyssal — Select Workspace Folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const wsPath = result.filePaths[0]!;
    if (!isWorkspace(wsPath)) scaffoldWorkspace({ rootDir: wsPath });
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.touchRecent(wsPath);
    return wsPath;
  });

  // ── workspace:listRecent ──

  typedHandler('workspace:listRecent', logger, async () => {
    try {
      const mgr = new WorkspaceManager(app.getPath('userData'));
      return mgr.getRecentWorkspaces() as any;
    } catch {
      return [];
    }
  });

  // ── workspace:getCurrent ──

  typedHandler('workspace:getCurrent', logger, async () => {
    if (!ctx.workspaceRoot) return null;
    const wsPaths = getWorkspacePaths(ctx.workspaceRoot);
    return {
      rootDir: ctx.workspaceRoot,
      name: ctx.config.project.name,
      paths: wsPaths,
    } as any;
  });

  // ── workspace:switch ──

  typedHandler('workspace:switch', logger, async (_e, workspacePath) => {
    // Scaffold new workspace if needed
    if (!isWorkspace(workspacePath)) {
      scaffoldWorkspace({ rootDir: workspacePath });
    }

    const previousWorkspaceRoot = ctx.workspaceRoot;
    const previousLockHandle = ctx.lockHandle;
    const previousDbProxy = ctx.dbProxy;
    const previousConfig = ctx.config;

    // Acquire lock + load config for new workspace without tearing down the old one first.
    const newLockHandle = acquireLock(workspacePath);

    let newProxy: ReturnType<typeof createDbProxy> | null = null;
    let newConfig = previousConfig;
    try {
      const globalConfig = loadGlobalConfig(app.getPath('userData'));
      newConfig = ConfigLoader.loadFromWorkspace(workspacePath, globalConfig);

      // Create and start new DB proxy before switching the live context.
      const dbProcessPath = path.resolve(__dirname, '..', 'db-process', 'main.js');
      newProxy = createDbProxy({ dbProcessPath });
      await newProxy.start({
        workspaceRoot: workspacePath,
        userDataPath: app.getPath('userData'),
        skipVecExtension: false,
      });

      ctx.workspaceRoot = workspacePath;
      ctx.lockHandle = newLockHandle;
      ctx.configProvider.update(newConfig);
      ctx.dbProxy = newProxy;

      // Refresh framework state with the new context before releasing old resources.
      await ctx.refreshFrameworkState();
    } catch (err) {
      try { await newProxy?.close(); } catch { /* ignore */ }
      newLockHandle.release();
      ctx.workspaceRoot = previousWorkspaceRoot;
      ctx.lockHandle = previousLockHandle;
      ctx.configProvider.update(previousConfig);
      ctx.dbProxy = previousDbProxy;
      throw err;
    }

    // Graceful shutdown of the previous DB proxy and lock after the new one is ready.
    try { await previousDbProxy?.close(); } catch { /* ignore */ }
    previousLockHandle?.release();

    // Touch recent list
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.touchRecent(workspacePath, ctx.config.project.name);

    // Notify renderer
    ctx.pushManager?.pushWorkspaceSwitched({
      rootDir: workspacePath,
      name: ctx.config.project.name,
    });

    logger.info('Workspace switched', { workspacePath });
  });

  // ── workspace:removeRecent ──

  typedHandler('workspace:removeRecent', logger, async (_e, workspacePath) => {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.removeRecent(workspacePath);
  });

  // ── workspace:togglePin ──

  typedHandler('workspace:togglePin', logger, async (_e, workspacePath) => {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    return mgr.togglePin(workspacePath);
  });

  // ── app:switchProject (deprecated — delegates to workspace:switch) ──

  typedHandler('app:switchProject', logger, async () => {
    throw new Error('Use workspace:switch channel instead');
  });

  // ── app:listProjects ──

  typedHandler('app:listProjects', logger, async () => {
    try {
      const mgr = new WorkspaceManager(app.getPath('userData'));
      const recent = mgr.getRecentWorkspaces();
      return recent.map((r: { name: string; path: string; lastOpenedAt: string }) => ({
        name: r.name,
        paperCount: 0,
        conceptCount: 0,
        lastModified: r.lastOpenedAt,
        workspacePath: r.path,
      })) as any;
    } catch {
      return [];
    }
  });

  // ── app:createProject ──

  typedHandler('app:createProject', logger, async (_e, config) => {
    const cfg = (config as unknown as Record<string, unknown>) ?? {};
    const projectName = (cfg['name'] as string) ?? 'New Project';

    const result = await dialog.showOpenDialog({
      title: `Select location for "${projectName}"`,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Create Here',
    });

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error('User cancelled directory selection');
    }

    const rootDir = path.join(result.filePaths[0]!, projectName);
    const scaffoldResult = scaffoldWorkspace({
      rootDir,
      name: projectName,
      description: (cfg['description'] as string) ?? '',
    });

    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.touchRecent(rootDir, projectName);

    return {
      name: scaffoldResult.meta.name,
      paperCount: 0,
      conceptCount: 0,
      lastModified: scaffoldResult.meta.createdAt,
      workspacePath: rootDir,
    } as any;
  });
}
