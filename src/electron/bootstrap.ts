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

import { FileLogger, ConsoleLogger, type Logger } from '../core/infra/logger';
import { ConfigLoader } from '../core/infra/config';
import { DEFAULT_CONFIG } from '../core/config/config-loader';
import { loadGlobalConfig } from '../core/infra/global-config';
import { isWorkspace, scaffoldWorkspace, getWorkspacePaths, WorkspaceManager } from '../core/workspace';
import { createDbProxy, type DbProxyInstance } from '../db-process/db-proxy';
import { createBibliographyService } from '../core/bibliography';
import { createRagService, type RagService } from '../core/rag';
import { createDatabaseService, type DatabaseService } from '../core/database';
import type { AbyssalConfig, GlobalConfig } from '../core/types/config';
import { ConfigProvider } from '../core/infra/config-provider';
import { createLlmClient, type LlmClient } from '../adapter/llm-client/llm-client';
import { createEmbedFunction } from '../adapter/llm-client/embed-function-factory';
import { RerankerScheduler } from '../adapter/llm-client/reranker';
import { createContextBudgetManager } from '../adapter/context-budget/context-budget-manager';
import { WorkflowRunner } from '../adapter/orchestrator/workflow-runner';
import { createAnalyzeWorkflow } from '../adapter/orchestrator/workflows/analyze';
import { createSynthesizeWorkflow } from '../adapter/orchestrator/workflows/synthesize';
import { createBibliographyWorkflow } from '../adapter/orchestrator/workflows/bibliography';
import { createDiscoverWorkflow } from '../adapter/orchestrator/workflows/discover';
import { createAcquireWorkflow } from '../adapter/orchestrator/workflows/acquire';
import { createProcessWorkflow } from '../adapter/orchestrator/workflows/process';
import { createAcquireService } from '../core/acquire';
import { createProcessService } from '../core/process';
import { createSearchService } from '../core/search';
import { IdentifierResolver } from '../core/acquire/identifier-resolver';
import { ContentSanityChecker } from '../core/acquire/content-sanity-checker';
import { FailureMemory } from '../core/acquire/failure-memory';
import { createRateLimiter } from '../core/infra/rate-limiter';
import { HttpClient } from '../core/infra/http-client';
import { createArticleWorkflow } from '../adapter/orchestrator/workflows/article';
import { AdvisoryAgent } from '../adapter/advisory-agent/advisory-agent';
import { CookieJar } from '../core/infra/cookie-jar';
import { ReconCache, type ReconCacheDb } from '../core/acquire/recon-cache';
import { setupEventBridge } from './ipc/event-bridge';
import { EventBus } from '../core/event-bus';
import { ResearchSession } from '../core/session';
import { createCapabilityRegistry, type CapabilityServices } from '../adapter/capabilities';
import { SessionOrchestrator } from '../adapter/orchestrator/session-orchestrator';
import { buildChatSystemPrompt } from './chat-system-prompt';
import { testApiKeyDirect, testConfiguredApiKey } from '../core/infra/api-key-diagnostics';

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
  configProvider: ConfigProvider | null;
  logger: Logger | null;
  dbProxy: DbProxyInstance | null;
  vecEnabled: boolean;
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

  // Create ConfigProvider — the single source of truth for runtime config
  if (ctx.config) {
    ctx.configProvider = new ConfigProvider(ctx.config);
  }
}

// ─── Step 4: Logger initialization ───

async function step4_initLogger(ctx: BootstrapContext): Promise<void> {
  const wsPaths = getWorkspacePaths(ctx.args.workspace);
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(wsPaths.logs, { recursive: true });

  // CLI --log-level overrides config; otherwise use config.logging.level
  const logLevel = ctx.args.logLevel !== 'info'
    ? ctx.args.logLevel
    : (ctx.config?.logging.level ?? 'info');
  const logger = new FileLogger(wsPaths.logs, logLevel, ctx.args.dev);
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
    logLevel,
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
    const dbProxy = createDbProxy({
      dbProcessPath,
      onHealthStatus: (status) => {
        // Push to renderer if PushManager is available (set up in Step 6)
        ctx.appContext?.pushManager?.pushDbHealth({ status });
      },
    });

    await dbProxy.start({
      workspaceRoot: ctx.args.workspace,
      userDataPath: app.getPath('userData'),
      skipVecExtension: false,
    });

    ctx.dbProxy = dbProxy;
    ctx.vecEnabled = true;
    logger.info('DB subprocess started', {
      workspace: ctx.args.workspace,
      vectorSearch: 'enabled',
    });
  } catch (err) {
    const errMsg = (err as Error).message;
    logger.error('Database initialization failed', err as Error);

    // Determine error type for user-friendly message
    let title = 'Database Error';
    let detail = errMsg;

    if (errMsg.includes('migration') || errMsg.includes('Migration')) {
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
  const configProvider = ctx.configProvider!;
  const dbProxy = ctx.dbProxy!;

  // ── Layer 1: Core modules (no LLM dependency) ──
  const bibliographyModule = createBibliographyService(config, logger);
  const acquireModule = createAcquireService(config, logger);
  logger.info('AcquireService initialized', {
    enableCnki: config.acquire.enableCnki,
    enableWanfang: config.acquire.enableWanfang,
    enableChinaInstitutional: config.acquire.enableChinaInstitutional,
    chinaInstitutionId: config.acquire.chinaInstitutionId,
    enabledSources: config.acquire.enabledSources,
  });
  // Keep AcquireService config in sync when user changes settings at runtime
  configProvider.onChange((event) => {
    if (event.changedSections.includes('acquire') || event.changedSections.includes('apiKeys')) {
      acquireModule.updateConfig(event.current);
      logger.info('AcquireService config updated at runtime', {
        changedSections: event.changedSections,
        enableCnki: event.current.acquire.enableCnki,
        enableWanfang: event.current.acquire.enableWanfang,
      });
    }
  });
  const processModule = createProcessService(config, null, logger);
  const searchModule = createSearchService(config, logger);

  // ── Web Search Service (Tavily / SerpAPI / Bing) ──
  const { createWebSearchService } = await import('../core/search/web-search');

  /** 根据语言配置推导 Bing mkt 参数 */
  function deriveBingMarket(cfg: AbyssalConfig): string {
    const lang = cfg.language?.defaultOutputLanguage ?? 'en';
    if (/^zh/i.test(lang)) return 'zh-CN';
    if (/^ja/i.test(lang)) return 'ja-JP';
    if (/^ko/i.test(lang)) return 'ko-KR';
    if (/^de/i.test(lang)) return 'de-DE';
    if (/^fr/i.test(lang)) return 'fr-FR';
    if (/^es/i.test(lang)) return 'es-ES';
    return 'en-US';
  }

  function buildWebSearchService(
    cfg: AbyssalConfig,
  ): import('../core/search/web-search').WebSearchService | null {
    if (!cfg.webSearch?.enabled) return null;
    if (!cfg.apiKeys.webSearchApiKey) return null;

    try {
      const svc = createWebSearchService(new HttpClient({ logger }), logger, {
        backend: cfg.webSearch.backend ?? 'tavily',
        apiKey: cfg.apiKeys.webSearchApiKey,
        market: deriveBingMarket(cfg),
      });
      logger.info('WebSearchService initialized', { backend: cfg.webSearch.backend });
      return svc;
    } catch (err) {
      logger.warn('Failed to create WebSearchService', { error: (err as Error).message });
      return null;
    }
  }

  function getWebSearchDisabledReason(): string {
    const cfg = configProvider.config;
    if (!cfg.webSearch?.enabled) {
      return 'Web search is disabled. Enable it in Settings → Web Search.';
    }
    if (!cfg.apiKeys.webSearchApiKey) {
      return 'Web search API key not configured. Add it in Settings → API Keys.';
    }
    return 'Web search service failed to initialize. Check logs for details.';
  }

  let webSearchService = buildWebSearchService(config);

  // ── Layer 2: Reranker (API backends) ──
  const reranker = new RerankerScheduler(configProvider, logger);

  // ── Layer 3: EmbedFunction + LlmClient ──
  const embedFn = createEmbedFunction({ configProvider, logger });

  let llmClient: LlmClient | null = null;
  const hasAnyApiKey = !!(
    config.apiKeys.anthropicApiKey ||
    config.apiKeys.openaiApiKey ||
    config.apiKeys.deepseekApiKey
  );
  if (hasAnyApiKey) {
    try {
      llmClient = createLlmClient({
        configProvider,
        logger,
        reranker,
        embedFn,
      });
      logger.info('LlmClient initialized', {
        embedding: embedFn.isAvailable ? 'enabled' : 'disabled',
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

  // ── Layer 3.5: RagService (depends on EmbedFunction + DB) ──
  // RagService requires synchronous DB access (direct SQL via better-sqlite3).
  // dbProxy is async (IPC to child process), so we open a separate read-only
  // connection. WAL mode supports concurrent readers safely.
  let ragService: RagService | null = null;
  let ragDbService: DatabaseService | null = null;
  if (embedFn.isAvailable) {
    try {
      const wsPaths = getWorkspacePaths(ctx.args.workspace);
      ragDbService = createDatabaseService({
        dbPath: wsPaths.db,
        config,
        logger,
        readOnly: true,
      });
      ragService = createRagService(embedFn, ragDbService, config, logger);
      logger.info('RagService initialized (read-only direct DB connection)');
    } catch (err) {
      logger.warn('RagService initialization failed', { error: (err as Error).message });
      // Clean up partial DB connection
      if (ragDbService) {
        try { ragDbService.close(); } catch { /* ignore */ }
        ragDbService = null;
      }
    }
  } else {
    logger.warn('RagService skipped — no embedding API key configured. Vector indexing will be unavailable.', {
      embeddingProvider: config.rag.embeddingProvider,
      embeddingModel: config.rag.embeddingModel,
    });
  }

  // ── Layer 4: Context Budget Manager ──
  const contextBudgetManager = createContextBudgetManager(logger);

  // ── Assemble AppContext ──
  ctx.appContext = createAppContext({
    configProvider,
    logger,
    dbProxy,
    lockHandle: ctx.lockHandle!,
    workspaceRoot: ctx.args.workspace,
    acquireModule,
    processModule,
    bibliographyModule,
    ragModule: ragService,
    searchModule,
  });

  // Inject adapter-layer modules
  ctx.appContext.llmClient = llmClient;
  ctx.appContext.contextBudgetManager = contextBudgetManager;
  ctx.appContext.ragDbService = ragDbService;

  // Wire cost tracking to llm_audit_log table
  if (llmClient) {
    llmClient.setCostPersistFn((entry) => {
      dbProxy.insertAuditLog({
        workflowId: entry.workflowId,
        model: entry.model,
        provider: entry.provider,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        durationMs: entry.durationMs,
        costUsd: entry.costUsd,
        paperId: entry.paperId,
        finishReason: entry.finishReason,
      }).catch(() => { /* audit log failure is non-critical */ });
    });
  }

  // Create PushManager
  const pushManager = new PushManager();
  ctx.appContext.pushManager = pushManager;

  // ── CookieJar for institutional access ──
  const userDataPath = app.getPath('userData');
  const cookieJar = new CookieJar(userDataPath, (level, msg, meta) => {
    if (level === 'error') {
      logger.error(`[CookieJar] ${msg}`, undefined, meta);
    } else {
      logger[level](`[CookieJar] ${msg}`, meta);
    }
  });
  ctx.appContext.cookieJar = cookieJar;
  acquireModule.setCookieJar(cookieJar);
  logger.info('CookieJar initialized', {
    hasExistingSession: cookieJar.getActiveDomains().length > 0,
    institutionId: cookieJar.getInstitutionId(),
  });

  // ── BrowserWindow-based search for CNKI/Wanfang ──
  const { createBrowserSearchFn } = await import('./browser-search');
  const browserSearchFn = createBrowserSearchFn(
    () => cookieJar.getInstitutionId(),
    logger,
  );
  acquireModule.setBrowserSearch(browserSearchFn);

  // ── ReconCache for acquire pipeline v2 ──
  const reconCacheDb: ReconCacheDb = {
    getRecon: (doi: string) => (dbProxy as any).getRecon(doi),
    upsertRecon: (recon: any) => (dbProxy as any).upsertRecon(recon),
  };
  const reconCache = new ReconCache(reconCacheDb, logger);
  acquireModule.setReconCache(reconCache);

  // ── Layer 5: WorkflowRunner + AgentLoop + AdvisoryAgent ──
  const workflowRunner = new WorkflowRunner(logger, pushManager);

  // Register all workflows
  workflowRunner.registerWorkflow('discover', createDiscoverWorkflow({
    dbProxy: dbProxy as any,
    searchService: searchModule,
    llmClient,
    logger,
    config: { discovery: config.discovery as any, project: config.project as any },
    frameworkState: () => ctx.appContext!.frameworkState,
  }));
  // ── LLM-enhanced acquire services (Feature 1/2/3) ──
  const llmCallFn = llmClient
    ? async (systemPrompt: string, userPrompt: string, workflowId: string) => {
        const result = await llmClient!.complete({
          systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          maxTokens: 200,
          temperature: 0,
          workflowId,
        });
        return result.text;
      }
    : null;

  const resolverHttp = new HttpClient({ logger, userAgentEmail: config.apiKeys.openalexEmail ?? undefined });
  const s2ApiKey = config.apiKeys.semanticScholarApiKey ?? null;
  const identifierResolver = new IdentifierResolver(
    resolverHttp,
    createRateLimiter('crossRef'),
    createRateLimiter(s2ApiKey ? 'semanticScholarWithKey' : 'semanticScholarNoKey'),
    s2ApiKey,
    llmCallFn,
    logger,
  );

  const sanityChecker = new ContentSanityChecker(llmCallFn, logger);

  // FailureMemory: uses in-memory cache (no direct DB dependency from main process)
  const failureMemory = new FailureMemory(null, logger, config.acquire.failureMemoryWindowDays);
  acquireModule.setFailureMemory(failureMemory);

  workflowRunner.registerWorkflow('acquire', createAcquireWorkflow({
    dbProxy: dbProxy as any,
    acquireService: acquireModule,
    identifierResolver,
    sanityChecker,
    failureMemory,
    acquireConfig: config.acquire,
    logger,
    workspacePath: ctx.args.workspace,
  }));

  workflowRunner.registerWorkflow('process', createProcessWorkflow({
    dbProxy: dbProxy as any,
    processService: processModule,
    ragService: ragService as any,
    bibliographyService: bibliographyModule as any,
    logger,
    workspacePath: ctx.args.workspace,
    hydrateConfig: {
      enableLlmExtraction: !!llmCallFn,
      enableApiLookup: true,
    },
    llmCallFn,
    lookupService: {
      getPaperDetails: (id: string) => searchModule.getPaperDetails(id).catch(() => null),
      searchByTitle: (title: string) => searchModule.searchSemanticScholar(title, { limit: 3 }).catch(() => []),
    },
    enrichService: bibliographyModule ? {
      enrichByDoi: async (doi: string) => {
        try {
          const result = await (bibliographyModule as any).enrichBibliography({ doi } as any);
          return result?.metadata ?? null;
        } catch { return null; }
      },
    } : null,
    hydratePersist: {
      upsertReferences: (paperId, refs) => {
        (dbProxy as any).upsertReferences(paperId, refs);
      },
      insertHydrateLogs: (paperId, logs) => {
        (dbProxy as any).insertHydrateLogs(paperId, logs);
      },
    },
    ocrLinesPersist: {
      insertOcrLines: (lines) => {
        (dbProxy as any).insertOcrLines(lines);
      },
      deleteOcrLines: (paperId) => {
        (dbProxy as any).deleteOcrLines(paperId);
      },
    },
  }));
  if (llmClient) {
    workflowRunner.registerWorkflow('analyze', createAnalyzeWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      frameworkState: () => ctx.appContext!.frameworkState,
      workspacePath: ctx.args.workspace,
      outputLanguage: configProvider.config.language.defaultOutputLanguage,
      ragService: ragService ? {
        retrieve: async (query: string, options?: { paperId?: string; topK?: number }) => {
          const result = await ragService!.retrieve({
            queryText: query,
            taskType: 'analyze',
            conceptIds: [],
            paperIds: options?.paperId ? [options.paperId as any] : [],
            sectionTypeFilter: null,
            sourceFilter: null,
            budgetMode: 'focused',
            maxTokens: 50_000,
            modelContextWindow: 200_000,
            enableCorrectiveRag: true,
            relatedMemoIds: [],
            skipReranker: false,
            skipQueryExpansion: false,
          });
          return {
            passages: result.chunks.map((c) => ({
              text: c.text,
              paperId: c.paperId as string,
              score: c.score,
              chunkId: c.chunkId as string,
            })),
            qualityReport: result.qualityReport,
          };
        },
      } : null,
    }));
    workflowRunner.registerWorkflow('synthesize', createSynthesizeWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      ragService: ragService as any,
      workspacePath: ctx.args.workspace,
    }));
    workflowRunner.registerWorkflow('article', createArticleWorkflow({
      dbProxy: dbProxy as any, llmClient, contextBudgetManager, logger,
      ragService: ragService as any,
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

  // ── Layer 5.5: AI-Centric Workbench (EventBus + Session + Capabilities + Orchestrator) ──

  const eventBus = new EventBus({
    historySize: 200,
    debug: ctx.args.dev,
    logger: (msg, data) => logger.debug(msg, data as Record<string, unknown>),
  });
  // Throttle high-frequency user events to avoid flooding proactive rules
  eventBus.useThrottle(['user:pageChange', 'user:selectText'], 200);
  ctx.appContext.eventBus = eventBus;

  const researchSession = new ResearchSession((msg, data) => logger.debug(msg, data as Record<string, unknown>));
  researchSession.bind(eventBus);
  ctx.appContext.session = researchSession;

  // Build CapabilityServices from existing modules
  const capabilityServices: CapabilityServices = {
    dbProxy: dbProxy as any,
    searchService: searchModule,
    ragService: ragService as any,
    orchestrator: workflowRunner as any,
    addPaper: async (paper) => {
      const { generatePaperId } = await import('../core/search/paper-id');
      const id = generatePaperId(
        (paper['doi'] as string) ?? null,
        null,
        (paper['title'] as string) ?? '',
      );
      await dbProxy.addPaper({ ...paper, id } as any, { fulltextStatus: 'not_attempted' } as any);
      return id;
    },
    updatePaper: async (id, fields) => {
      await dbProxy.updatePaper(id as any, fields as any);
    },
    pushManager: pushManager as any,
    writeNoteFile: async (noteId: string, content: string) => {
      const fsp = await import('node:fs/promises');
      const notesDir = path.join(ctx.args.workspace, 'notes');
      await fsp.mkdir(notesDir, { recursive: true });
      const absPath = path.join(notesDir, `${noteId}.md`);
      await fsp.writeFile(absPath, content, 'utf-8');
    },
    confirmWrite: null, // Set up after IPC registration
    configProvider: {
      config: configProvider.config as any,
      update: async (section, patch) => {
        const current = structuredClone(configProvider.config);
        const sectionObj = ((current as any)[section] ?? {}) as Record<string, unknown>;
        Object.assign(sectionObj, patch);
        (current as any)[section] = sectionObj;
        configProvider.update(current);
      },
    },
    apiDiagnostics: {
      testProvider: async (provider, apiKey) => {
        if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
          return testApiKeyDirect(provider, apiKey);
        }
        return testConfiguredApiKey(provider, configProvider.config.apiKeys);
      },
    },
  };

  const capabilityRegistry = createCapabilityRegistry(
    researchSession, eventBus, capabilityServices,
    (msg, data) => logger.debug(msg, data as Record<string, unknown>),
  );
  ctx.appContext.capabilityRegistry = capabilityRegistry;

  // SessionOrchestrator (requires LlmClient)
  if (llmClient) {
    const sessionOrchestrator = new SessionOrchestrator({
      eventBus,
      session: researchSession,
      capabilities: capabilityRegistry,
      llmClient,
      pushManager,
      buildSystemPrompt: async (chatContext) => buildChatSystemPrompt(ctx.appContext!, chatContext),
      maxRounds: 15,
      proactiveEnabled: (configProvider.config as any).ai?.proactiveSuggestions ?? false,
      logger: (msg, data) => logger.debug(msg, data as Record<string, unknown>),
    });
    sessionOrchestrator.start();
    ctx.appContext.sessionOrchestrator = sessionOrchestrator;
    logger.info('SessionOrchestrator started', {
      capabilities: capabilityRegistry.operationCount,
      proactive: true,
    });
  }

  // Restore persisted session state from previous run
  try {
    // Restore working memory
    const savedMemory = await dbProxy.loadSessionMemory();
    if (savedMemory.length > 0) {
      const entries = savedMemory
        .filter((row) => row.type !== 'observation')
        .map((row) => ({
        id: row.id,
        type: row.type as import('../core/session/working-memory').MemoryEntryType,
        content: row.content,
        source: row.source,
        linkedEntities: JSON.parse(row.linked_entities) as string[],
        importance: row.importance,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        ...(row.tags ? { tags: JSON.parse(row.tags) as string[] } : {}),
      }));
      researchSession.memory.loadEntries(entries);
      logger.info('Working memory restored', {
        entries: entries.length,
        droppedObservation: savedMemory.length - entries.length,
      });
    }

    // Restore conversation
    if (ctx.appContext.sessionOrchestrator) {
      const savedConversation = await dbProxy.loadSessionConversation('workspace');
      if (savedConversation) {
        ctx.appContext.sessionOrchestrator.restoreConversation(savedConversation);
      }
    }
  } catch (err) {
    logger.warn('Failed to restore session state', { error: (err as Error).message });
  }

  logger.info('AI workbench layers initialized', {
    eventBus: true,
    session: true,
    capabilities: capabilityRegistry.operationCount,
    orchestrator: !!ctx.appContext.sessionOrchestrator,
  });

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

  // ── Layer 6: DLA (Document Layout Analysis) — optional ──
  try {
    const { DlaProxy } = await import('../core/dla/dla-proxy');
    const { DlaScheduler } = await import('../core/dla/scheduler');
    const fs = require('node:fs') as typeof import('node:fs');

    // Model path: dev → assets/models/, packaged → resources/models/
    const modelDir = app.isPackaged
      ? path.join(process.resourcesPath, 'models')
      : path.join(__dirname, '..', '..', 'assets', 'models');
    const modelPath = path.join(modelDir, 'doclayout-yolo.onnx');

    if (fs.existsSync(modelPath)) {
      const dlaProcessPath = path.resolve(__dirname, '..', 'dla-process', 'main.js');
      const dlaProxy = new DlaProxy({
        dlaProcessPath,
        modelPath,
        executionProvider: 'cpu',
      });

      const dlaScheduler = new DlaScheduler(dlaProxy, logger);

      // Wire push notifications: when a page is analyzed, push to renderer
      dlaScheduler.setPageReadyCallback((paperId, pageIndex, blocks) => {
        pushManager.pushDlaPageReady({
          paperId,
          pageIndex,
          blocks: blocks.map((b) => ({
            type: b.type,
            bbox: { x: b.bbox.x, y: b.bbox.y, w: b.bbox.w, h: b.bbox.h },
            confidence: b.confidence,
            pageIndex: b.pageIndex,
          })),
        });
      });

      ctx.appContext.dlaProxy = dlaProxy;
      ctx.appContext.dlaScheduler = dlaScheduler;

      // Start subprocess in background (non-blocking)
      dlaProxy.start().then(() => {
        logger.info('DLA subprocess started', { modelPath });
      }).catch((err: Error) => {
        logger.warn('DLA subprocess failed to start (non-critical)', { error: err.message });
      });

      // Listen for DLA errors
      dlaProxy.on('error', (err: Error) => {
        logger.warn('DLA subprocess error', { error: err.message });
      });
    } else {
      logger.info('DLA model not found — layout analysis disabled', { modelPath });
    }
  } catch (err) {
    logger.warn('DLA initialization failed (non-critical)', { error: (err as Error).message });
  }

  logger.info('Core modules instantiated', {
    workflows: Array.from(workflowRunner.activeWorkflowMap.keys()).length === 0 ? 'all registered' : 'active',
    agentLoop: !!ctx.appContext.agentLoop,
    advisoryAgent: true,
    dla: !!ctx.appContext.dlaProxy,
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

  // Reset orphan 'pending' fulltext statuses from previous unclean shutdown.
  // At startup no acquire workflow is running, so any 'pending' is stale.
  try {
    const pendingPapers = (await appCtx.dbProxy.queryPapers({ fulltextStatus: ['pending'] })) as unknown as { items: Array<Record<string, unknown>> };
    for (const p of pendingPapers.items) {
      await appCtx.dbProxy.updatePaper(p['id'] as any, { fulltextStatus: 'not_attempted' } as any);
    }
    if (pendingPapers.items.length > 0) {
      logger.info('Reset orphan pending fulltext statuses', { count: pendingPapers.items.length });
    }
  } catch { /* non-critical */ }

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

// ─── Lobby mode bootstrap (first launch, no workspace) ───

/**
 * Bootstrap without a workspace — only show the setup wizard.
 *
 * Creates a minimal AppContext with no DB. IPC handlers are registered but
 * DB-dependent ones will return errors if called. The wizard only uses
 * createProject / listProjects / window handlers, so this is safe.
 *
 * After the user creates a project, workspace:switch performs full init.
 */
async function bootstrapLobbyMode(ctx: BootstrapContext): Promise<void> {
  const logger = new ConsoleLogger('info');
  ctx.logger = logger;
  logger.info('Lobby mode: no workspace — waiting for project creation');

  const globalConfig = loadGlobalConfig(app.getPath('userData'));
  ctx.globalConfig = globalConfig;

  // Minimal config from defaults (no workspace config file)
  const defaultConfig = structuredClone(DEFAULT_CONFIG) as AbyssalConfig;
  ctx.config = defaultConfig;
  ctx.configProvider = new ConfigProvider(defaultConfig);

  // Create a shell AppContext — dbProxy is null, handlers will
  // check ctx.dbProxy and throw gracefully via wrapHandler's try/catch.
  const pushManager = new PushManager();
  ctx.appContext = {
    configProvider: ctx.configProvider,
    get config() { return this.configProvider.config; },
    logger,
    dbProxy: null as unknown as DbProxyInstance, // null — lobby mode
    searchModule: null,
    acquireModule: null,
    processModule: null,
    ragModule: null,
    bibliographyModule: null,
    llmClient: null,
    contextBudgetManager: null,
    orchestrator: null,
    agentLoop: null,
    advisoryAgent: null,
    activeWorkflows: new Map(),
    mainWindow: null,
    frameworkState: 'zero_concepts',
    workerThread: null,
    lockHandle: null,
    pushManager,
    staleDrafts: new Set(),
    cookieJar: null,
    ragDbService: null,
    dlaProxy: null,
    dlaScheduler: null,
    eventBus: null,
    session: null,
    capabilityRegistry: null,
    sessionOrchestrator: null,
    isShuttingDown: false,
    startedAt: Date.now(),
    workspaceRoot: '',
    async refreshFrameworkState() { /* no-op in lobby mode */ },
    async getStats() {
      return { paperCount: 0, conceptCount: 0, frameworkState: 'zero_concepts' as FrameworkState, activeWorkflows: 0, uptimeMs: 0 };
    },
  };

  // Register IPC handlers + create window
  registerAllHandlers(ctx.appContext);
  const mainWindow = createMainWindow({ isDev: ctx.args.dev, logger });
  ctx.appContext.mainWindow = mainWindow;
  pushManager.setWindow(mainWindow);

  logger.info('Lobby mode ready — wizard will auto-show');
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
    configProvider: null,
    logger: null,
    dbProxy: null,
    vecEnabled: false,
    appContext: null,
    frameworkState: null,
  };

  // Check for recent workspace from WorkspaceManager
  let lobbyMode = false;
  try {
    const mgr = new WorkspaceManager(app.getPath('userData'));
    const recent = mgr.getRecentWorkspaces();
    const defaultWs = path.join(app.getPath('userData'), 'workspace');
    if (ctx.args.workspace === defaultWs && recent.length > 0) {
      // Use most recently opened workspace
      ctx.args.workspace = recent[0]!.path;
    } else if (ctx.args.workspace === defaultWs && recent.length === 0) {
      // First launch — no workspace to open, enter lobby mode
      lobbyMode = true;
    }
  } catch { /* ignore — use default */ }

  try {
    if (lobbyMode) {
      // ── Lobby mode: no workspace, just show wizard ──
      // Create minimal infrastructure so IPC handlers can be registered.
      // DB-dependent handlers will return errors if called, but the wizard
      // only uses createProject/listProjects/window handlers.
      await bootstrapLobbyMode(ctx);
      return ctx.appContext!;
    }

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

    // Wire EventBus ↔ IPC bridge (after IPC + window are ready)
    if (ctx.appContext!.eventBus && ctx.appContext!.pushManager) {
      setupEventBridge(
        ctx.appContext!.eventBus,
        ctx.appContext!.pushManager,
        (msg, data) => ctx.logger!.debug(msg, data ?? {}),
      );
    }

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

