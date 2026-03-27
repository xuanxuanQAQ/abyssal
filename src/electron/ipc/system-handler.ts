/**
 * IPC handler: system namespace
 *
 * Contract channels: db:tags:*, db:discoverRuns:*, db:relations:*,
 *                    fs:openPDF, fs:savePDFAnnotations, fs:exportArticle, fs:importFiles,
 *                    app:*, app:window:*, workspace:*
 * Plus reader:pageChanged fire-and-forget event.
 */

import { ipcMain, dialog, app } from 'electron';
import * as path from 'node:path';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asPaperId } from '../../core/types/common';
import type { RelationGraphFilter } from '../../core/database/dao/relations';
import { acquireLock } from '../lock';
import { ConfigLoader } from '../../core/infra/config';
import { loadGlobalConfig } from '../../core/infra/global-config';
import { createDbProxy } from '../../db-process/db-proxy';
import { WorkspaceManager, scaffoldWorkspace, isWorkspace, getWorkspacePaths } from '../../core/workspace';

export function registerSystemHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  // ── db:tags ──

  typedHandler('db:tags:list', logger, async () => []);

  typedHandler('db:tags:create', logger, async (_e, name, parentId?) => ({
    id: crypto.randomUUID(), name, parentId: parentId ?? null, paperCount: 0, color: null,
  }) as any);

  typedHandler('db:tags:update', logger, async () => {});

  typedHandler('db:tags:delete', logger, async () => {});

  // ── db:discoverRuns ──

  typedHandler('db:discoverRuns:list', logger, async () => []);

  // ── db:relations ──

  typedHandler('db:relations:getGraph', logger, async (_e, filter?) => {
    const f = (filter as Record<string, unknown>) ?? {};
    return await dbProxy.getRelationGraph({
      centerId: f['focusNodeId'] ? asPaperId(f['focusNodeId'] as string) : undefined,
      depth: (f['hopDepth'] as number) ?? 2,
    } as RelationGraphFilter) as any;
  });

  typedHandler('db:relations:getNeighborhood', logger, async (_e, nodeId, depth, _layers?) => {
    return await dbProxy.getRelationGraph({
      centerId: asPaperId(nodeId),
      depth: depth ?? 2,
    } as RelationGraphFilter) as any;
  });

  // ── fs ──

  typedHandler('fs:openPDF', logger, async () => {
    throw new Error('Not implemented');
  });

  typedHandler('fs:savePDFAnnotations', logger, async () => {});

  typedHandler('fs:exportArticle', logger, async () => {
    throw new Error('Not implemented');
  });

  typedHandler('fs:importFiles', logger, async () => ({
    imported: 0, skipped: 0, errors: [],
  }) as any);

  // fs:readNoteFile and fs:saveNoteFile are registered in notes-handler.ts

  // ── app ──

  typedHandler('app:getConfig', logger, async () => ({
    language: 'zh',
    llmProvider: ctx.config.llm.defaultProvider,
    llmModel: ctx.config.llm.defaultModel,
    workspacePath: ctx.workspaceRoot,
  }) as any);

  typedHandler('app:updateConfig', logger, async () => {});

  typedHandler('app:getProjectInfo', logger, async () => {
    try {
      const stats = (await dbProxy.getStats()) as any as {
        papers: { total: number };
        concepts: { total: number };
      };
      return {
        name: ctx.config.project.name,
        paperCount: stats.papers.total,
        conceptCount: stats.concepts.total,
        lastModified: new Date().toISOString(),
        workspaceRoot: ctx.workspaceRoot,
      } as any;
    } catch {
      return {
        name: ctx.config.project.name,
        paperCount: 0,
        conceptCount: 0,
        lastModified: new Date().toISOString(),
        workspaceRoot: ctx.workspaceRoot,
      } as any;
    }
  });

  typedHandler('app:switchProject', logger, async () => {
    throw new Error('Use workspace:switch channel instead');
  });

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

    const path = require('node:path');
    const rootDir = path.join(result.filePaths[0], projectName);
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

  typedHandler('app:globalSearch', logger, async (_e, query) => {
    try {
      const q = (query ?? '').trim();
      if (!q) return [];
      const papers = (await dbProxy.queryPapers({ searchText: q, limit: 10 })) as any as {
        items: Array<Record<string, unknown>>;
      };
      return papers.items.map((p) => ({
        type: 'paper' as const,
        id: p['id'],
        title: p['title'],
        snippet: ((p['abstract'] as string) ?? '').slice(0, 200),
      })) as any;
    } catch {
      return [];
    }
  });

  // ── app:window ──

  typedHandler('app:window:minimize', logger, async () => {
    ctx.mainWindow?.minimize();
  });

  typedHandler('app:window:toggleMaximize', logger, async () => {
    const win = ctx.mainWindow;
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  typedHandler('app:window:close', logger, async () => {
    ctx.mainWindow?.close();
  });

  typedHandler('app:window:popOut', logger, async () => {
    throw new Error('Multi-window not supported');
  });

  typedHandler('app:window:list', logger, async () => []);

  // ── workspace ──

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

  typedHandler('workspace:listRecent', logger, async () => {
    try {
      const mgr = new WorkspaceManager(app.getPath('userData'));
      return mgr.getRecentWorkspaces() as any;
    } catch {
      return [];
    }
  });

  typedHandler('workspace:getCurrent', logger, async () => {
    if (!ctx.workspaceRoot) return null;
    const wsPaths = getWorkspacePaths(ctx.workspaceRoot);
    return {
      rootDir: ctx.workspaceRoot,
      name: ctx.config.project.name,
      paths: wsPaths,
    } as any;
  });

  typedHandler('workspace:switch', logger, async (_e, workspacePath) => {
    // Graceful shutdown of current DB proxy and lock
    try { await ctx.dbProxy.close(); } catch { /* ignore */ }
    ctx.lockHandle?.release();

    // Scaffold new workspace if needed
    if (!isWorkspace(workspacePath)) {
      scaffoldWorkspace({ rootDir: workspacePath });
    }

    // Acquire lock + load config for new workspace
    ctx.workspaceRoot = workspacePath;
    ctx.lockHandle = acquireLock(workspacePath);

    const globalConfig = loadGlobalConfig(app.getPath('userData'));
    ctx.config = ConfigLoader.loadFromWorkspace(workspacePath, globalConfig);

    // Create and start new DB proxy
    const dbProcessPath = path.resolve(__dirname, '..', '..', 'db-process', 'main.js');
    const newProxy = createDbProxy({ dbProcessPath });
    await newProxy.start({
      workspaceRoot: workspacePath,
      userDataPath: app.getPath('userData'),
      skipVecExtension: true,
    });
    ctx.dbProxy = newProxy;

    // Refresh framework state
    await ctx.refreshFrameworkState();

    // Touch recent list
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.touchRecent(workspacePath, ctx.config.project.name);

    // Notify renderer
    ctx.mainWindow?.webContents.send('workspace:switched$event', {
      rootDir: workspacePath,
      name: ctx.config.project.name,
    });

    logger.info('Workspace switched', { workspacePath });
  });

  typedHandler('workspace:removeRecent', logger, async (_e, workspacePath) => {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    mgr.removeRecent(workspacePath);
  });

  typedHandler('workspace:togglePin', logger, async (_e, workspacePath) => {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    return mgr.togglePin(workspacePath);
  });

  // ── Reader page changed event (fire-and-forget) ──

  ipcMain.on(
    'reader:pageChanged',
    (_event: Electron.IpcMainEvent, _paperId: unknown, _page: unknown) => {
      // TODO: connect to analysis engine for concept mapping evidence on current page
    },
  );
}
