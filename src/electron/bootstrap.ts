/**
 * Bootstrap — 11-step startup sequence for the Electron main process.
 *
 * Step 1:  Command-line argument parsing
 * Step 2:  Process exclusive lock
 * Step 3:  Configuration loading
 * Step 4:  Logger initialization + global error handlers
 * Step 5:  Database initialization (DB subprocess)
 * Step 6:  Core module instantiation (dependency topology)
 * Step 7:  IPC channel registration
 * Step 8:  Create main window
 * Step 9:  Framework state evaluation
 * Step 10: Advisory Agent first run (async, non-blocking)
 * Step 11: Ready — show window, check pending items
 *
 * See spec: section 1 — Eleven-Stage Startup Sequence
 */

import { app, dialog } from 'electron';
import * as path from 'node:path';

import { acquireLock, LockError, type LockHandle } from './lock';
import { createAppContext, type AppContext, type FrameworkState } from './app-context';
import { createMainWindow, getMainWindow } from './window-manager';
import { registerAllHandlers } from './ipc/register';
import { PushManager } from './ipc/push';
import { registerGlobalErrorHandlers } from './lifecycle';

import { FileLogger, type Logger } from '../core/infra/logger';
import { ConfigLoader } from '../core/infra/config';
import { loadGlobalConfig } from '../core/infra/global-config';
import { isWorkspace, scaffoldWorkspace, getWorkspacePaths, WorkspaceManager } from '../core/workspace';
import { createDbProxy, type DbProxyInstance } from '../db-process/db-proxy';
import { createBibliographyService } from '../core/bibliography';
import type { AbyssalConfig, GlobalConfig } from '../core/types/config';
import { createLlmClient, type LlmClient } from '../adapter/llm-client/llm-client';
import { RerankerScheduler } from '../adapter/llm-client/reranker';
import { createContextBudgetManager } from '../adapter/context-budget/context-budget-manager';
import { WorkflowRunner } from '../adapter/orchestrator/workflow-runner';
import { createAnalyzeWorkflow } from '../adapter/orchestrator/workflows/analyze';
import { createSynthesizeWorkflow } from '../adapter/orchestrator/workflows/synthesize';
import { createBibliographyWorkflow } from '../adapter/orchestrator/workflows/bibliography';
import { createDiscoverWorkflow } from '../adapter/orchestrator/workflows/discover';
import { createAcquireWorkflow } from '../adapter/orchestrator/workflows/acquire';
import { createArticleWorkflow } from '../adapter/orchestrator/workflows/article';
import { AgentLoop } from '../adapter/agent-loop/agent-loop';
import { ToolRegistry } from '../adapter/agent-loop/tool-registry';
import { AdvisoryAgent } from '../adapter/advisory-agent/advisory-agent';

// ─── ParsedArgs ───

export interface ParsedArgs {
  workspace: string;
  dev: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ─── BootstrapContext (filled incrementally) ───

interface BootstrapContext {
  args: ParsedArgs;
  lockHandle: LockHandle | null;
  globalConfig: GlobalConfig | null;
  config: AbyssalConfig | null;
  logger: Logger | null;
  dbProxy: DbProxyInstance | null;
  appContext: AppContext | null;
  frameworkState: FrameworkState | null;
}

// ─── Step 1: Command-line argument parsing ───

function parseArgs(): ParsedArgs {
  const argv = process.argv;
  let workspace = path.join(app.getPath('userData'), 'workspace');
  let dev = false;
  let logLevel: ParsedArgs['logLevel'] = 'info';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      workspace = path.resolve(argv[++i]!);
    } else if (arg === '--dev' || arg === '-d') {
      dev = true;
    } else if ((arg === '--log-level' || arg === '-l') && argv[i + 1]) {
      logLevel = argv[++i] as ParsedArgs['logLevel'];
    }
  }

  // Also check NODE_ENV for dev mode
  if (!dev && (process.env['NODE_ENV'] === 'development' || !app.isPackaged)) {
    dev = true;
  }

  return { workspace, dev, logLevel };
}

// ─── Step 2: Process exclusive lock ───

async function step2_acquireLock(ctx: BootstrapContext): Promise<void> {
  // Ensure workspace directory exists
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(ctx.args.workspace, { recursive: true });

  try {
    ctx.lockHandle = acquireLock(ctx.args.workspace);
  } catch (err) {
    if (err instanceof LockError) {
      dialog.showErrorBox(
        'Abyssal — Workspace Locked',
        `Another instance is using this workspace.\nPID: ${err.pid}\nStarted: ${err.startedAt}`,
      );
      app.quit();
      return;
    }
    dialog.showErrorBox(
      'Abyssal — Lock Error',
      `Cannot acquire workspace lock: ${(err as Error).message}\nPath: ${ctx.args.workspace}`,
    );
    app.quit();
  }
}

// ─── Step 3: Configuration loading ───

async function step3_loadConfig(ctx: BootstrapContext): Promise<void> {
  const userDataPath = app.getPath('userData');
  ctx.globalConfig = loadGlobalConfig(userDataPath);

  if (!isWorkspace(ctx.args.workspace)) {
    scaffoldWorkspace({ rootDir: ctx.args.workspace });
  }

  try {
    ctx.config = ConfigLoader.loadFromWorkspace(ctx.args.workspace, ctx.globalConfig);
  } catch (err) {
    // Attempt recovery: rename corrupted config and retry
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const configPath = path.join(ctx.args.workspace, '.abyssal', 'config.toml');
      if (fs.existsSync(configPath)) {
        fs.renameSync(configPath, configPath + '.corrupted');
      }
    } catch { /* ignore rename failure */ }

    try {
      ctx.config = ConfigLoader.loadFromWorkspace(ctx.args.workspace, ctx.globalConfig!);
    } catch (retryErr) {
      dialog.showErrorBox(
        'Abyssal — Configuration Error',
        `Failed to load configuration: ${(retryErr as Error).message}`,
      );
      ctx.lockHandle?.release();
      app.quit();
    }
  }
}

// ─── Step 4: Logger initialization ───

async function step4_initLogger(ctx: BootstrapContext): Promise<void> {
  const wsPaths = getWorkspacePaths(ctx.args.workspace);
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(wsPaths.logs, { recursive: true });

  const logger = new FileLogger(wsPaths.logs, ctx.args.logLevel);
  logger.cleanupOldLogs();
  ctx.logger = logger;

  // Register global error handlers (uncaughtException, unhandledRejection).
  // ctx.appContext is null at this point (set in Step 6) — that's OK,
  // lifecycle.ts accepts null and uses optional chaining.
  // We pass null explicitly rather than ctx.appContext to make the intent clear.
  registerGlobalErrorHandlers(null, ctx.args.workspace, logger);

  logger.info('Abyssal starting', {
    workspace: ctx.args.workspace,
    dev: ctx.args.dev,
    logLevel: ctx.args.logLevel,
    electronVersion: process.versions['electron'] ?? 'N/A',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });
}

// ─── Step 5: Database initialization ───

async function step5_initDatabase(ctx: BootstrapContext): Promise<void> {
  const logger = ctx.logger!;

  try {
    const dbProcessPath = path.resolve(__dirname, '..', 'db-process', 'main.js');
    const dbProxy = createDbProxy({ dbProcessPath });

    await dbProxy.start({
      workspaceRoot: ctx.args.workspace,
      userDataPath: app.getPath('userData'),
      skipVecExtension: true,
    });

    ctx.dbProxy = dbProxy;
    logger.info('DB subprocess started', { workspace: ctx.args.workspace });
  } catch (err) {
    const errMsg = (err as Error).message;
    logger.error('Database initialization failed', err as Error);

    // Determine error type for user-friendly message
    let title = 'Database Error';
    let detail = errMsg;

    if (errMsg.includes('Extension') || errMsg.includes('sqlite-vec')) {
      title = 'Database Extension Error';
      detail = `sqlite-vec extension failed to load.\nPlatform: ${process.platform}/${process.arch}\n\n${errMsg}`;
    } else if (errMsg.includes('migration') || errMsg.includes('Migration')) {
      title = 'Database Migration Error';
      detail = `Schema migration failed. Consider restoring from a snapshot.\n\n${errMsg}`;
    }

    dialog.showErrorBox(`Abyssal — ${title}`, detail);
    ctx.lockHandle?.release();
    app.quit();
  }
}

// ─── Step 6: Core module instantiation ───

async function step6_instantiateModules(ctx: BootstrapContext): Promise<void> {
  const config = ctx.config!;
  const logger = ctx.logger!;
  const dbProxy = ctx.dbProxy!;

  // ── Layer 1: Core modules (no LLM dependency) ──
  const bibliographyModule = createBibliographyService(config, logger);
  // TODO: wire up when fully integrated with IPC proxy pattern
  // const searchModule = createSearchService(config, logger);
  // const acquireModule = createAcquireService(config, logger);
  // const processModule = createProcessService(config, null);

  // ── Layer 2: Reranker (may start Worker Thread) ──
  const reranker = new RerankerScheduler(config.rag, config.apiKeys, logger);
  if (config.rag.rerankerBackend === 'local-bge') {
    try {
      await reranker.startWorker(config.rag.localRerankerModelPath ?? undefined);
    } catch (err) {
      logger.warn('Local ONNX reranker failed to start, falling back to vector score', {
        error: (err as Error).message,
      });
    }
  }

  // ── Layer 3: LlmClient (depends on reranker) ──
  let llmClient: LlmClient | null = null;
  const hasAnyApiKey = !!(
    config.apiKeys.anthropicApiKey ||
    config.apiKeys.openaiApiKey ||
    config.apiKeys.deepseekApiKey
  );
  if (hasAnyApiKey) {
    try {
      llmClient = createLlmClient({
        config,
        logger,
        reranker,
        // TODO: inject EmbedFunction when embedder is wired up
        embedFn: null,
      });
      logger.info('LlmClient initialized', {
        providers: [
          config.apiKeys.anthropicApiKey ? 'anthropic' : null,
          config.apiKeys.openaiApiKey ? 'openai' : null,
          config.apiKeys.deepseekApiKey ? 'deepseek' : null,
        ].filter(Boolean),
      });
    } catch (err) {
      logger.warn('LlmClient initialization failed', { error: (err as Error).message });
    }
  } else {
    logger.info('No API keys configured — LlmClient disabled');
  }

  // ── Layer 4: Context Budget Manager ──
  const contextBudgetManager = createContextBudgetManager(logger);

  // ── Assemble AppContext ──
  ctx.appContext = createAppContext({
    config,
    logger,
    dbProxy,
    lockHandle: ctx.lockHandle!,
    workspaceRoot: ctx.args.workspace,
    bibliographyModule,
  });

  // Inject adapter-layer modules
  ctx.appContext.llmClient = llmClient;
  ctx.appContext.contextBudgetManager = contextBudgetManager;

  // Create PushManager
  const pushManager = new PushManager();
  ctx.appContext.pushManager = pushManager;

  // ── Layer 5: WorkflowRunner + AgentLoop + AdvisoryAgent ──
  const workflowRunner = new WorkflowRunner(logger, pushManager);

  // Register all workflows
  // TODO: Wire SearchService, AcquireService, ProcessService for Electron GUI.
  // For now, discover/acquire are registered with placeholder services that
  // will log warnings when invoked without proper configuration.
  workflowRunner.registerWorkflow('discover', createDiscoverWorkflow({
    dbProxy: dbProxy as any,
    searchService: null as any, // TODO: createSearchService(config, logger)
    llmClient,
    logger,
    config: { discovery: config.discovery as any, project: config.project as any },
    frameworkState: ctx.appContext.frameworkState,
  }));
  workflowRunner.registerWorkflow('acquire', createAcquireWorkflow({
    dbProxy: dbProxy as any,
    acquireService: null as any, // TODO: new AcquireService(config, logger)
    processService: null as any, // TODO: new ProcessService(config)
    ragService: null,
    bibliographyService: bibliographyModule as any,
    logger,
    workspacePath: ctx.args.workspace,
  }));
  if (llmClient) {
    workflowRunner.registerWorkflow('analyze', createAnalyzeWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      frameworkState: ctx.appContext.frameworkState,
      workspacePath: ctx.args.workspace,
    }));
    workflowRunner.registerWorkflow('synthesize', createSynthesizeWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      ragService: null, // TODO: wire RagService for Electron
      workspacePath: ctx.args.workspace,
    }));
    workflowRunner.registerWorkflow('article', createArticleWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      ragService: null, // TODO: wire RagService for Electron
      workspacePath: ctx.args.workspace,
    }));
  }
  workflowRunner.registerWorkflow('bibliography', createBibliographyWorkflow({
    dbProxy: dbProxy as any,
    bibliographyService: bibliographyModule as any,
    logger,
    workspacePath: ctx.args.workspace,
  }));

  ctx.appContext.orchestrator = workflowRunner;

  // AgentLoop (requires LlmClient)
  if (llmClient) {
    const toolRegistry = new ToolRegistry({
      dbProxy: dbProxy as any,
      // TODO: wire searchService and ragService when available in Electron context
      searchService: null,
      ragService: null,
    });
    const agentLoop = new AgentLoop({
      llmClient,
      toolRegistry,
      pushManager,
      getSystemPromptContext: async () => {
        const stats = await ctx.appContext!.getStats();
        const allConcepts = (await dbProxy.getAllConcepts()) as unknown as Array<Record<string, unknown>>;
        const activeConcepts = allConcepts.filter((c) => !c['deprecated']);
        // Fetch detailed stats via raw query
        let analyzedPapers = 0;
        let acquiredPapers = 0;
        let memoCount = 0;
        let noteCount = 0;
        let totalMappings = 0;
        let reviewedMappings = 0;
        try {
          const detailedStats = await dbProxy.getStats() as unknown as Record<string, unknown>;
          analyzedPapers = (detailedStats['analyzedPapers'] as number) ?? 0;
          acquiredPapers = (detailedStats['acquiredPapers'] as number) ?? 0;
          memoCount = (detailedStats['memoCount'] as number) ?? 0;
          noteCount = (detailedStats['noteCount'] as number) ?? 0;
          totalMappings = (detailedStats['totalMappings'] as number) ?? 0;
          reviewedMappings = (detailedStats['reviewedMappings'] as number) ?? 0;
        } catch { /* use defaults */ }

        return {
          projectName: config.project.name,
          frameworkState: ctx.appContext!.frameworkState,
          conceptCount: activeConcepts.length,
          tentativeCount: activeConcepts.filter((c) => c['maturity'] === 'tentative').length,
          workingCount: activeConcepts.filter((c) => c['maturity'] === 'working').length,
          establishedCount: activeConcepts.filter((c) => c['maturity'] === 'established').length,
          totalPapers: stats.paperCount,
          analyzedPapers,
          acquiredPapers,
          memoCount,
          noteCount,
          topConcepts: activeConcepts.slice(0, 10).map((c) => ({
            nameEn: (c['nameEn'] ?? c['name_en']) as string ?? '',
            maturity: (c['maturity'] as string) ?? 'working',
            mappedPapers: 0, // TODO: count per-concept mappings
          })),
          advisorySuggestions: ctx.appContext!.advisoryAgent?.getLatestSuggestions() ?? [],
          toolCount: toolRegistry.toolCount,
        };
      },
    });
    ctx.appContext.agentLoop = agentLoop;
  }

  // AdvisoryAgent — queryFn delegates to DbProxy for diagnostic SQL
  const advisoryAgent = new AdvisoryAgent({
    llmClient,
    pushManager,
    logger,
    queryFn: async (sql: string) => {
      // Delegate to dbProxy's rawQuery if available, otherwise try direct query
      try {
        if (typeof (dbProxy as any).rawQuery === 'function') {
          return await (dbProxy as any).rawQuery(sql);
        }
        // Fallback: use the sync dbService if dbProxy wraps it
        // The diagnostic queries are SELECT-only (safe for read access)
        const result = await dbProxy.getStats(); // This confirms DB is accessible
        // TODO: Expose a rawQuery method on DbProxy for diagnostic SQL.
        // For now, diagnostic queries will return empty results.
        return [];
      } catch {
        return [];
      }
    },
    getProjectStats: async () => {
      const stats = await ctx.appContext!.getStats();
      let memoCount = 0;
      try {
        const detailedStats = await dbProxy.getStats() as unknown as Record<string, unknown>;
        memoCount = (detailedStats['memoCount'] as number) ?? 0;
      } catch { /* use default */ }
      return { papers: stats.paperCount, concepts: stats.conceptCount, memos: memoCount };
    },
  });
  ctx.appContext.advisoryAgent = advisoryAgent;

  // ── Layer 4 overrides (VisionCapable injection for ProcessModule) ──
  // TODO: when processModule is wired up:
  // if (llmClient) processModule.visionCapable = llmClient.asVisionCapable();

  logger.info('Core modules instantiated', {
    workflows: Array.from(workflowRunner.activeWorkflowMap.keys()).length === 0 ? 'all registered' : 'active',
    agentLoop: !!ctx.appContext.agentLoop,
    advisoryAgent: true,
  });
}

// ─── Step 7: IPC channel registration ───

async function step7_registerIPC(ctx: BootstrapContext): Promise<void> {
  registerAllHandlers(ctx.appContext!);
}

// ─── Step 8: Create main window ───

async function step8_createWindow(ctx: BootstrapContext): Promise<void> {
  const mainWindow = createMainWindow({
    isDev: ctx.args.dev,
    logger: ctx.logger!,
  });

  ctx.appContext!.mainWindow = mainWindow;
  ctx.appContext!.pushManager!.setWindow(mainWindow);
}

// ─── Step 9: Framework state evaluation ───

async function step9_evaluateFrameworkState(ctx: BootstrapContext): Promise<void> {
  try {
    await ctx.appContext!.refreshFrameworkState();
    ctx.frameworkState = ctx.appContext!.frameworkState;
    ctx.logger!.info('Framework state evaluated', {
      state: ctx.frameworkState,
    });
  } catch (err) {
    ctx.logger!.warn('Framework state evaluation failed, defaulting to zero_concepts', {
      error: (err as Error).message,
    });
    ctx.frameworkState = 'zero_concepts';
  }
}

// ─── Step 10: Advisory Agent first run ───

async function step10_advisoryAgent(ctx: BootstrapContext): Promise<void> {
  const advisoryAgent = ctx.appContext?.advisoryAgent;
  if (!advisoryAgent) {
    ctx.logger!.debug('Advisory agent: skipped (not initialized)');
    return;
  }

  // Async, non-blocking, 30s timeout (§6.1)
  try {
    await advisoryAgent.generateSuggestions();
  } catch (err) {
    ctx.logger!.warn('Advisory agent first run failed (non-critical)', {
      error: (err as Error).message,
    });
  }
}

// ─── Step 11: Ready ───

async function step11_ready(ctx: BootstrapContext): Promise<void> {
  const mainWindow = getMainWindow();
  const appCtx = ctx.appContext!;
  const logger = ctx.logger!;

  // Show window (deferred from Step 8)
  mainWindow?.show();

  // Check pending concept suggestions
  try {
    const suggestions = (await appCtx.dbProxy.getSuggestedConcepts()) as unknown as Array<Record<string, unknown>>;
    const pendingCount = suggestions.filter(
      (s) => s['status'] === 'pending',
    ).length;
    if (pendingCount > 0) {
      appCtx.pushManager?.pushNotification({
        type: 'info',
        title: 'Concept Suggestions',
        message: `${pendingCount} concept suggestion(s) awaiting review.`,
      });
    }
  } catch { /* non-critical */ }

  // Log ready state
  try {
    const stats = await appCtx.getStats();
    logger.info('Application ready', {
      frameworkState: ctx.frameworkState,
      papers: stats.paperCount,
      concepts: stats.conceptCount,
    });
  } catch {
    logger.info('Application ready', {
      frameworkState: ctx.frameworkState,
    });
  }
}

// ─── Main bootstrap function ───

/**
 * Execute the 11-step bootstrap sequence.
 *
 * Called from main.ts after app.whenReady().
 * Each step fills BootstrapContext incrementally.
 * On failure, earlier resources are cleaned up before app.quit().
 */
export async function bootstrap(): Promise<AppContext> {
  const ctx: BootstrapContext = {
    args: parseArgs(),
    lockHandle: null,
    globalConfig: null,
    config: null,
    logger: null,
    dbProxy: null,
    appContext: null,
    frameworkState: null,
  };

  // Check for recent workspace from WorkspaceManager
  try {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    const recent = mgr.getRecentWorkspaces();
    // If workspace is default and there's a recent one, use it
    const defaultWs = path.join(app.getPath('userData'), 'workspace');
    if (ctx.args.workspace === defaultWs && recent.length > 0) {
      ctx.args.workspace = recent[0]!.path;
    }
  } catch { /* ignore — use default */ }

  try {
    await step2_acquireLock(ctx);
    if (!ctx.lockHandle) return null!; // app.quit() was called

    await step3_loadConfig(ctx);
    if (!ctx.config) return null!;

    await step4_initLogger(ctx);
    await step5_initDatabase(ctx);
    if (!ctx.dbProxy) return null!;

    await step6_instantiateModules(ctx);
    await step7_registerIPC(ctx);
    await step8_createWindow(ctx);

    // Steps 9-11 run after renderer loads (did-finish-load)
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.on('did-finish-load', async () => {
        await step9_evaluateFrameworkState(ctx);
        await step10_advisoryAgent(ctx);
        await step11_ready(ctx);
      });
    }

    return ctx.appContext!;
  } catch (err) {
    // Cleanup based on how far we got
    const error = err as Error;
    console.error('[Bootstrap] Fatal error:', error.message);

    if (ctx.logger) {
      ctx.logger.error('Bootstrap failed', error);
    }

    if (ctx.dbProxy) {
      try { await ctx.dbProxy.close(); } catch { /* ignore */ }
    }

    if (ctx.lockHandle) {
      ctx.lockHandle.release();
    }

    dialog.showErrorBox(
      'Abyssal — Startup Error',
      `Application failed to start:\n\n${error.message}`,
    );
    app.quit();
    return null!;
  }
}

