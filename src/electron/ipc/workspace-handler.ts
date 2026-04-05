/**
 * IPC handler: workspace namespace
 *
 * Contract channels: workspace:create, workspace:openDialog, workspace:listRecent,
 *   workspace:getCurrent, workspace:switch, workspace:removeRecent, workspace:togglePin,
 *   app:switchProject, app:listProjects, app:createProject
 */

import { dialog, app } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { acquireLock } from '../lock';
import { ConfigLoader } from '../../core/infra/config';
import { loadGlobalConfig, saveGlobalConfig } from '../../core/infra/global-config';
import { createDbProxy } from '../../db-process/db-proxy';
import {
  WorkspaceManager,
  scaffoldWorkspace,
  isWorkspace,
  getWorkspacePaths,
} from '../../core/workspace';
import { EMBEDDING_MODEL_REGISTRY, type EmbeddingProvider } from '../../core/config/config-schema';
import type { GlobalConfig } from '../../core/types/config';
import type { ProjectSetupConfig } from '../../shared-types/models';

const PROVIDER_API_KEY_FIELDS: Record<string, keyof GlobalConfig['apiKeys']> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  gemini: 'geminiApiKey',
  deepseek: 'deepseekApiKey',
  siliconflow: 'siliconflowApiKey',
  cohere: 'cohereApiKey',
  jina: 'jinaApiKey',
  tavily: 'webSearchApiKey',
  serpapi: 'webSearchApiKey',
  bing: 'webSearchApiKey',
};

const SOURCE_PRESETS: Record<'china' | 'overseas', string[]> = {
  china: ['cnki', 'wanfang', 'unpaywall', 'arxiv', 'pmc', 'scihub'],
  overseas: ['unpaywall', 'arxiv', 'pmc'],
};

function toTomlValue(val: unknown): string {
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

async function saveWorkspaceSections(
  workspaceRoot: string,
  patches: Record<string, Record<string, unknown>>,
): Promise<void> {
  const configDir = path.join(workspaceRoot, '.abyssal');
  const configPath = path.join(configDir, 'config.toml');

  let raw: Record<string, unknown> = {};
  try {
    const toml = require('smol-toml');
    raw = toml.parse(await fsp.readFile(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {}

  for (const [section, patch] of Object.entries(patches)) {
    const existing = (raw[section] ?? {}) as Record<string, unknown>;
    raw[section] = { ...existing, ...patch };
  }

  const lines: string[] = ['# Abyssal workspace config (auto-generated)', ''];
  for (const [sectionName, sectionValue] of Object.entries(raw)) {
    if (!sectionValue || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) continue;
    lines.push(`[${sectionName}]`);
    for (const [key, val] of Object.entries(sectionValue as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      if (typeof val === 'object' && !Array.isArray(val)) {
        lines.push('');
        lines.push(`[${sectionName}.${key}]`);
        for (const [subKey, subValue] of Object.entries(val as Record<string, unknown>)) {
          if (subValue === null || subValue === undefined) continue;
          lines.push(`${subKey} = ${toTomlValue(subValue)}`);
        }
      } else {
        lines.push(`${key} = ${toTomlValue(val)}`);
      }
    }
    lines.push('');
  }

  await fsp.mkdir(configDir, { recursive: true });
  await fsp.writeFile(configPath, lines.join('\n'), 'utf-8');
}

function applyApiKey(
  patch: Partial<GlobalConfig['apiKeys']>,
  provider: string | undefined,
  apiKey: string | undefined,
): void {
  const trimmed = apiKey?.trim();
  if (!provider || !trimmed) return;
  const field = PROVIDER_API_KEY_FIELDS[provider];
  if (field) {
    patch[field] = trimmed;
  }
}

function inferEnabledSources(config: ProjectSetupConfig): string[] | undefined {
  if (config.enabledSources && config.enabledSources.length > 0) {
    return config.enabledSources;
  }
  if (config.sourcePreset === 'china' || config.sourcePreset === 'overseas') {
    return SOURCE_PRESETS[config.sourcePreset];
  }
  return undefined;
}

async function persistProjectSetupConfig(
  ctx: AppContext,
  workspaceRoot: string,
  config: ProjectSetupConfig,
): Promise<void> {
  const embeddingModelSpec = EMBEDDING_MODEL_REGISTRY[config.embeddingProvider as EmbeddingProvider]
    ?.find((entry) => entry.model === config.embeddingModel);
  const enabledSources = inferEnabledSources(config);

  const apiKeysPatch: Partial<GlobalConfig['apiKeys']> = {
    ...(config.semanticScholarApiKey?.trim() ? { semanticScholarApiKey: config.semanticScholarApiKey.trim() } : {}),
    ...(config.webSearchApiKey?.trim() ? { webSearchApiKey: config.webSearchApiKey.trim() } : {}),
  };

  applyApiKey(apiKeysPatch, config.llmProvider, config.llmApiKey);
  applyApiKey(apiKeysPatch, config.embeddingProvider, config.embeddingApiKey);
  applyApiKey(apiKeysPatch, config.rerankerBackend, config.rerankerApiKey);
  applyApiKey(apiKeysPatch, config.webSearchBackend, config.webSearchApiKey);

  saveGlobalConfig(app.getPath('userData'), {
    ...(Object.keys(apiKeysPatch).length > 0 ? { apiKeys: apiKeysPatch } : {}),
    llm: {
      defaultProvider: config.llmProvider,
      defaultModel: config.llmModel,
    } as any,
    rag: {
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      ...(embeddingModelSpec ? { embeddingDimension: embeddingModelSpec.dimension } : {}),
      rerankerBackend: config.rerankerBackend,
    } as any,
    acquire: {
      ...(enabledSources ? { enabledSources } : {}),
      ...(config.proxyEnabled !== undefined ? { proxyEnabled: config.proxyEnabled } : {}),
      ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
      ...(enabledSources ? {
        enableScihub: enabledSources.includes('scihub'),
        enableCnki: enabledSources.includes('cnki'),
        enableWanfang: enabledSources.includes('wanfang'),
      } : {}),
    } as any,
    webSearch: {
      enabled: config.webSearchEnabled ?? false,
      backend: config.webSearchBackend ?? 'tavily',
    } as any,
  } as Partial<GlobalConfig>);

  await saveWorkspaceSections(workspaceRoot, {
    project: {
      name: config.name,
    },
    language: {
      defaultOutputLanguage: config.outputLanguage,
    },
  });

  try {
    const globalConfig = loadGlobalConfig(app.getPath('userData'));
    const newConfig = ConfigLoader.loadFromWorkspace(ctx.workspaceRoot, globalConfig);
    ctx.configProvider.update(newConfig);
  } catch {
    // Creating a project can happen before an active workspace exists.
  }
}

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
    const defaultConfig: ProjectSetupConfig = {
      name: 'New Project',
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      rerankerBackend: 'cohere',
      outputLanguage: 'zh-CN',
    };
    const cfg: ProjectSetupConfig = (config as ProjectSetupConfig | undefined) ?? defaultConfig;
    const projectName = cfg.name || 'New Project';

    const baseDir = cfg.workspacePath ?? await (async () => {
      const result = await dialog.showOpenDialog({
        title: `Select location for "${projectName}"`,
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Create Here',
      });

      if (result.canceled || result.filePaths.length === 0) {
        throw new Error('User cancelled directory selection');
      }

      return result.filePaths[0]!;
    })();

    const rootDir = path.join(baseDir, projectName);
    const scaffoldResult = scaffoldWorkspace({
      rootDir,
      name: projectName,
      description: '',
    });

    await persistProjectSetupConfig(ctx, rootDir, cfg);

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
