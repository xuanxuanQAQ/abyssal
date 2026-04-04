import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getWorkspacePaths, isWorkspace, scaffoldWorkspace } from '../../src/core/workspace';

const appMock = {
  getPath: vi.fn<(name: string) => string>(),
  isPackaged: false,
  quit: vi.fn(),
  whenReady: vi.fn(),
  on: vi.fn(),
};

const dialogMock = {
  showErrorBox: vi.fn(),
};

vi.mock('electron', () => ({
  app: appMock,
  dialog: dialogMock,
  BrowserWindow: vi.fn(),
  screen: { getDisplayMatching: vi.fn(() => ({ id: 1 })) },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../../src/electron/app-context', () => ({
  createAppContext: vi.fn(),
}));

vi.mock('../../src/electron/window-manager', () => ({
  createMainWindow: vi.fn(),
  getMainWindow: vi.fn(),
}));

vi.mock('../../src/electron/ipc/register', () => ({
  registerAllHandlers: vi.fn(),
}));

vi.mock('../../src/electron/ipc/push', () => ({
  PushManager: class PushManager {},
}));

vi.mock('../../src/electron/lifecycle', () => ({
  registerGlobalErrorHandlers: vi.fn(),
}));

vi.mock('../../src/db-process/db-proxy', () => ({
  createDbProxy: vi.fn(),
}));

vi.mock('../../src/core/bibliography', () => ({
  createBibliographyService: vi.fn(),
}));

vi.mock('../../src/core/rag', () => ({
  createRagService: vi.fn(),
}));

vi.mock('../../src/core/database', () => ({
  createDatabaseService: vi.fn(),
}));

vi.mock('../../src/adapter/llm-client/llm-client', () => ({
  createLlmClient: vi.fn(),
}));

vi.mock('../../src/adapter/llm-client/embed-function-factory', () => ({
  createEmbedFunction: vi.fn(),
}));

vi.mock('../../src/adapter/llm-client/reranker', () => ({
  RerankerScheduler: class RerankerScheduler {},
}));

vi.mock('../../src/adapter/context-budget/context-budget-manager', () => ({
  createContextBudgetManager: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflow-runner', () => ({
  WorkflowRunner: class WorkflowRunner {},
}));

vi.mock('../../src/adapter/orchestrator/workflows/analyze', () => ({
  createAnalyzeWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/synthesize', () => ({
  createSynthesizeWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/bibliography', () => ({
  createBibliographyWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/discover', () => ({
  createDiscoverWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/acquire', () => ({
  createAcquireWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/process', () => ({
  createProcessWorkflow: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/workflows/article', () => ({
  createArticleWorkflow: vi.fn(),
}));

vi.mock('../../src/core/acquire', () => ({
  createAcquireService: vi.fn(),
}));

vi.mock('../../src/core/process', () => ({
  createProcessService: vi.fn(),
}));

vi.mock('../../src/core/search', () => ({
  createSearchService: vi.fn(),
}));

vi.mock('../../src/core/acquire/identifier-resolver', () => ({
  IdentifierResolver: class IdentifierResolver {},
}));

vi.mock('../../src/core/acquire/content-sanity-checker', () => ({
  ContentSanityChecker: class ContentSanityChecker {},
}));

vi.mock('../../src/core/acquire/failure-memory', () => ({
  FailureMemory: class FailureMemory {},
}));

vi.mock('../../src/core/infra/rate-limiter', () => ({
  createRateLimiter: vi.fn(),
}));

vi.mock('../../src/core/infra/http-client', () => ({
  HttpClient: class HttpClient {},
}));

vi.mock('../../src/adapter/advisory-agent/advisory-agent', () => ({
  AdvisoryAgent: class AdvisoryAgent {},
}));

vi.mock('../../src/core/infra/cookie-jar', () => ({
  CookieJar: class CookieJar {},
}));

vi.mock('../../src/core/acquire/recon-cache', () => ({
  ReconCache: class ReconCache {},
}));

vi.mock('../../src/electron/ipc/event-bridge', () => ({
  setupEventBridge: vi.fn(),
}));

vi.mock('../../src/core/event-bus', () => ({
  EventBus: class EventBus {},
}));

vi.mock('../../src/core/session', () => ({
  ResearchSession: class ResearchSession {},
}));

vi.mock('../../src/adapter/capabilities', () => ({
  createCapabilityRegistry: vi.fn(),
}));

vi.mock('../../src/adapter/orchestrator/session-orchestrator', () => ({
  SessionOrchestrator: class SessionOrchestrator {},
}));

vi.mock('../../src/electron/chat-system-prompt', () => ({
  buildChatSystemPrompt: vi.fn(),
}));

vi.mock('../../src/core/infra/api-key-diagnostics', () => ({
  testApiKeyDirect: vi.fn(),
  testConfiguredApiKey: vi.fn(),
}));

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeBootstrapContext(workspaceRoot: string) {
  return {
    args: {
      workspace: workspaceRoot,
      dev: false,
      logLevel: 'info' as const,
    },
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
}

describe('bootstrap startup config recovery', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    appMock.getPath.mockImplementation((name: string) => {
      if (name === 'userData') {
        return createdDirs[0] ?? os.tmpdir();
      }
      return os.tmpdir();
    });
  });

  afterEach(() => {
    vi.resetModules();
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scaffolds a missing workspace and loads runtime config on first startup', async () => {
    const appDataDir = makeTempDir('abyssal-bootstrap-appdata-');
    const workspaceParent = makeTempDir('abyssal-bootstrap-workspace-');
    const workspaceRoot = path.join(workspaceParent, 'first-launch');
    createdDirs.push(appDataDir, workspaceParent);

    const { __testing__ } = await import('../../src/electron/bootstrap');
    const ctx = makeBootstrapContext(workspaceRoot);

    await __testing__.step3_loadConfig(ctx);

    const paths = getWorkspacePaths(workspaceRoot);
    expect(isWorkspace(workspaceRoot)).toBe(true);
    expect(fs.existsSync(paths.config)).toBe(true);
    expect(ctx.config?.workspace.baseDir).toBe(workspaceRoot);
    expect(ctx.config?.project.name).toBe('first-launch');
    expect(ctx.configProvider?.config.workspace.baseDir).toBe(workspaceRoot);
  });

  it('moves a corrupted local workspace config aside and falls back to defaults', async () => {
    const appDataDir = makeTempDir('abyssal-bootstrap-appdata-');
    const workspaceRoot = makeTempDir('abyssal-bootstrap-workspace-');
    createdDirs.push(appDataDir, workspaceRoot);

    scaffoldWorkspace({ rootDir: workspaceRoot, name: 'Recovered Workspace' });
    const paths = getWorkspacePaths(workspaceRoot);
    fs.writeFileSync(paths.config, '[project\nname = "broken"', 'utf-8');

    const { __testing__ } = await import('../../src/electron/bootstrap');
    const ctx = makeBootstrapContext(workspaceRoot);

    await __testing__.step3_loadConfig(ctx);

    expect(fs.existsSync(paths.config + '.corrupted')).toBe(true);
    expect(ctx.config?.workspace.baseDir).toBe(workspaceRoot);
    expect(ctx.config?.language.defaultOutputLanguage).toBe('zh-CN');
    expect(dialogMock.showErrorBox).not.toHaveBeenCalled();
  });
});