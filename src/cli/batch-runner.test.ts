import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConfig } from '../__test-utils__/test-db';
import type { CliArgs } from './cli-entry';

const {
  acquireLockMock,
  loadFromWorkspaceMock,
  loadGlobalConfigMock,
  isWorkspaceMock,
  scaffoldWorkspaceMock,
  getWorkspacePathsMock,
  createDatabaseServiceMock,
  createBibliographyServiceMock,
  createSearchServiceMock,
  createLlmClientMock,
  createRagServiceMock,
  createContextBudgetManagerMock,
  createDiscoverWorkflowMock,
  createAcquireWorkflowMock,
  createProcessWorkflowMock,
  createAnalyzeWorkflowMock,
  createSynthesizeWorkflowMock,
  createBibliographyWorkflowMock,
  renderSummaryMock,
  validateConfigMock,
  runnerStartCalls,
  runnerCompletionResults,
  workflowRunnerInstances,
  dbService,
    deriveFrameworkStateMock,
} = vi.hoisted(() => {
  const runnerStartCalls: Array<{ type: string; options: Record<string, unknown> }> = [];
  const runnerCompletionResults: Array<Promise<unknown> | unknown> = [];
  const workflowRunnerInstances: any[] = [];
  const deriveFrameworkStateMock = vi.fn(() => 'working');
  const dbService = {
    getStats: vi.fn(),
    getSuggestedConcepts: vi.fn(),
    walCheckpoint: vi.fn(),
    close: vi.fn(),
    raw: {},
  };

  return {
    acquireLockMock: vi.fn(),
    loadFromWorkspaceMock: vi.fn(),
    loadGlobalConfigMock: vi.fn(),
    isWorkspaceMock: vi.fn(),
    scaffoldWorkspaceMock: vi.fn(),
    getWorkspacePathsMock: vi.fn(),
    createDatabaseServiceMock: vi.fn(),
    createBibliographyServiceMock: vi.fn(),
    createSearchServiceMock: vi.fn(),
    createLlmClientMock: vi.fn(),
    createRagServiceMock: vi.fn(),
    createContextBudgetManagerMock: vi.fn(),
    createDiscoverWorkflowMock: vi.fn(),
    createAcquireWorkflowMock: vi.fn(),
    createProcessWorkflowMock: vi.fn(),
    createAnalyzeWorkflowMock: vi.fn(),
    createSynthesizeWorkflowMock: vi.fn(),
    createBibliographyWorkflowMock: vi.fn(),
    renderSummaryMock: vi.fn(),
    validateConfigMock: vi.fn(),
    runnerStartCalls,
    runnerCompletionResults,
    workflowRunnerInstances,
    dbService,
    deriveFrameworkStateMock,
  };
});

vi.mock('../core/infra/logger', () => ({
  ConsoleLogger: class {
    constructor(_level: string) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
  FileLogger: class {
    constructor(_dir: string, _level: string) {}
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('../core/infra/config', () => ({
  ConfigLoader: {
    loadFromWorkspace: (...args: unknown[]) => loadFromWorkspaceMock(...args),
    load: (...args: unknown[]) => loadFromWorkspaceMock(...args),
  },
}));

vi.mock('../core/infra/global-config', () => ({
  loadGlobalConfig: (...args: unknown[]) => loadGlobalConfigMock(...args),
}));

vi.mock('../core/workspace', () => ({
  isWorkspace: (...args: unknown[]) => isWorkspaceMock(...args),
  scaffoldWorkspace: (...args: unknown[]) => scaffoldWorkspaceMock(...args),
  getWorkspacePaths: (...args: unknown[]) => getWorkspacePathsMock(...args),
}));

vi.mock('../core/database', () => ({
  createDatabaseService: (...args: unknown[]) => createDatabaseServiceMock(...args),
}));

vi.mock('../core/bibliography', () => ({
  createBibliographyService: (...args: unknown[]) => createBibliographyServiceMock(...args),
}));

vi.mock('../core/search', () => ({
  createSearchService: (...args: unknown[]) => createSearchServiceMock(...args),
}));

vi.mock('../core/acquire', () => ({
  AcquireService: class {
    constructor(_config: unknown, _logger: unknown) {}
  },
}));

vi.mock('../core/process', () => ({
  ProcessService: class {
    constructor(_config: unknown) {}
  },
}));

vi.mock('../electron/lock', () => ({
  acquireLock: (...args: unknown[]) => acquireLockMock(...args),
}));

vi.mock('../core/config/framework-state', () => ({
  deriveFrameworkState: (...args: unknown[]) => deriveFrameworkStateMock(...args),
}));

vi.mock('../core/config/config-validator', () => ({
  validateConfig: (...args: unknown[]) => validateConfigMock(...args),
}));

vi.mock('../core/config/hot-reload/concept-sync', () => ({
  syncConceptsFromYaml: vi.fn(() => ({ added: [], modified: [], deprecated: [], unchanged: [], renamed: [] })),
}));

vi.mock('../adapter/llm-client/llm-client', () => ({
  createLlmClient: (...args: unknown[]) => createLlmClientMock(...args),
}));

vi.mock('../adapter/llm-client/embed-function-factory', () => ({
  createEmbedFunction: vi.fn(() => ({ isAvailable: false })),
}));

vi.mock('../adapter/llm-client/reranker', () => ({
  RerankerScheduler: class {
    constructor(_configProvider: unknown, _logger: unknown) {}
  },
}));

vi.mock('../core/rag', () => ({
  createRagService: (...args: unknown[]) => createRagServiceMock(...args),
}));

vi.mock('../adapter/context-budget/context-budget-manager', () => ({
  createContextBudgetManager: (...args: unknown[]) => createContextBudgetManagerMock(...args),
}));

vi.mock('../adapter/orchestrator/workflow-runner', () => ({
  WorkflowRunner: class {
    activeWorkflowMap = new Map([['registered', true]]);
    registerWorkflow = vi.fn();
    start = vi.fn((type: string, options: Record<string, unknown>) => {
      runnerStartCalls.push({ type, options });
      const nextResult = runnerCompletionResults.shift();
      return {
        completionPromise: nextResult !== undefined
          ? Promise.resolve(nextResult)
          : Promise.resolve({
              status: 'completed',
              progress: {
                completedItems: 1,
                failedItems: 0,
                skippedItems: 0,
                totalItems: 1,
                errors: [],
              },
            }),
      };
    });

    constructor(_logger: unknown, _pushManager: unknown) {
      workflowRunnerInstances.push(this);
    }
  },
}));

vi.mock('../adapter/orchestrator/workflows/discover', () => ({
  createDiscoverWorkflow: (...args: unknown[]) => createDiscoverWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/workflows/acquire', () => ({
  createAcquireWorkflow: (...args: unknown[]) => createAcquireWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/workflows/process', () => ({
  createProcessWorkflow: (...args: unknown[]) => createProcessWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/workflows/analyze', () => ({
  createAnalyzeWorkflow: (...args: unknown[]) => createAnalyzeWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/workflows/synthesize', () => ({
  createSynthesizeWorkflow: (...args: unknown[]) => createSynthesizeWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/workflows/bibliography', () => ({
  createBibliographyWorkflow: (...args: unknown[]) => createBibliographyWorkflowMock(...args),
}));

vi.mock('../adapter/orchestrator/concurrency-guard', () => ({
  DEFAULT_CONCURRENCY: {
    discover: 2,
    acquire: 3,
    process: 4,
    analyze: 5,
    synthesize: 6,
    article: 7,
    bibliography: 8,
  },
}));

vi.mock('../adapter/orchestrator/error-classifier', () => ({
  CircuitBreakerTripped: class CircuitBreakerTripped extends Error {
    consecutiveFailures = 3;
    category = 'http_error';
  },
}));

vi.mock('./progress-renderer', () => ({
  renderSummary: (...args: unknown[]) => renderSummaryMock(...args),
}));

vi.mock('../core/infra/config-provider', () => ({
  ConfigProvider: class {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
  },
}));

import { batchRun } from './batch-runner';

function makeArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    stage: 'all',
    paperIds: ['paper-1'],
    filter: null,
    conceptIds: [],
    workspace: 'C:/tmp/abyssal-batch',
    configPath: null,
    concurrency: 0,
    dryRun: false,
    verbose: false,
    articleId: null,
    ...overrides,
  };
}

describe('batchRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runnerStartCalls.length = 0;
    runnerCompletionResults.length = 0;
    workflowRunnerInstances.length = 0;

    acquireLockMock.mockReturnValue({ release: vi.fn() });
    isWorkspaceMock.mockReturnValue(true);
    scaffoldWorkspaceMock.mockReturnValue(undefined);
    getWorkspacePathsMock.mockReturnValue({ logs: 'C:/tmp/abyssal-batch/logs' });
    loadGlobalConfigMock.mockReturnValue({});
    loadFromWorkspaceMock.mockReturnValue(createTestConfig({
      apiKeys: {
        anthropicApiKey: null,
        openaiApiKey: null,
        geminiApiKey: null,
        deepseekApiKey: null,
        semanticScholarApiKey: null,
        openalexEmail: null,
        unpaywallEmail: null,
        cohereApiKey: null,
        jinaApiKey: null,
        siliconflowApiKey: null,
        webSearchApiKey: null,
      },
    }));
    dbService.getStats.mockReturnValue({ concepts: { total: 2, tentative: 1, working: 1, established: 0 } });
    dbService.getSuggestedConcepts.mockReturnValue([]);
    createDatabaseServiceMock.mockReturnValue(dbService);
    createBibliographyServiceMock.mockReturnValue({});
    createSearchServiceMock.mockReturnValue({});
    createLlmClientMock.mockReturnValue(null);
    createRagServiceMock.mockReturnValue(null);
    createContextBudgetManagerMock.mockReturnValue({});
    createDiscoverWorkflowMock.mockReturnValue(vi.fn());
    createAcquireWorkflowMock.mockReturnValue(vi.fn());
    createProcessWorkflowMock.mockReturnValue(vi.fn());
    createAnalyzeWorkflowMock.mockReturnValue(vi.fn());
    createSynthesizeWorkflowMock.mockReturnValue(vi.fn());
    createBibliographyWorkflowMock.mockReturnValue(vi.fn());
    validateConfigMock.mockReturnValue({ warnings: [], frameworkState: 'working', concepts: [] });
    deriveFrameworkStateMock.mockReset();
    deriveFrameworkStateMock.mockReturnValue('working');
    renderSummaryMock.mockReturnValue('summary-output');
  });

  it('executes all stages in documented order and uses default per-stage concurrency when CLI concurrency is unset', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await batchRun(makeArgs());

    expect(runnerStartCalls.map((call) => call.type)).toEqual([
      'discover',
      'acquire',
      'process',
      'analyze',
      'synthesize',
      'article',
      'bibliography',
    ]);
    expect(runnerStartCalls.map((call) => call.options['concurrency'])).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(stdoutWrite).toHaveBeenCalledWith('summary-output\n');

    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
  });

  it('closes the database, releases the lock, and exits when initialization fails after DB startup', async () => {
    const lockHandle = { release: vi.fn() };
    acquireLockMock.mockReturnValue(lockHandle);
    createBibliographyServiceMock.mockImplementation(() => {
      throw new Error('bibliography init failed');
    });

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    await expect(batchRun(makeArgs({ stage: 'acquire' }))).rejects.toThrow('process.exit:1');

    expect(dbService.close).toHaveBeenCalledTimes(1);
    expect(lockHandle.release).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Fatal: bibliography init failed'));

    stderrWrite.mockRestore();
    exitSpy.mockRestore();
  });

  it('aggregates workflow progress and failure reasons into the rendered summary', async () => {
    runnerCompletionResults.push({
      status: 'partial',
      progress: {
        totalItems: 5,
        completedItems: 3,
        failedItems: 1,
        skippedItems: 1,
        errors: [
          { itemId: 'paper-2', stage: 'analyze', message: 'parse_failed', timestamp: new Date().toISOString() },
          { itemId: 'paper-3', stage: 'analyze', message: 'parse_failed', timestamp: new Date().toISOString() },
          { itemId: 'paper-4', stage: 'analyze', message: 'timeout', timestamp: new Date().toISOString() },
        ],
      },
    });
    dbService.getSuggestedConcepts.mockReturnValue([
      { term: 'Concept A', status: 'pending', sourcePaperCount: 4 },
      { term: 'Concept B', status: 'pending', sourcePaperCount: 2 },
    ]);

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await batchRun(makeArgs({ stage: 'discover' }));

    expect(renderSummaryMock).toHaveBeenCalledWith(expect.objectContaining({
      stageName: 'discover',
      total: 5,
      completed: 3,
      failed: 1,
      skipped: 1,
      failureReasons: {
        parse_failed: 2,
        timeout: 1,
      },
      conceptSuggestions: [
        { term: 'Concept A', paperCount: 4 },
      ],
    }));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Stage discover: partial (3/5)'));
    expect(stdoutWrite).toHaveBeenCalledWith('summary-output\n');

    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
  });

  it('preserves validated concept framework state when the database has not been synced from concepts.yaml yet', async () => {
    validateConfigMock.mockReturnValue({ warnings: [], frameworkState: 'framework_forming', concepts: [
      { id: 'c1', nameZh: '测试', nameEn: 'Test', layer: 'core', definition: 'def', searchKeywords: [], maturity: 'working', parentId: null, history: [], deprecated: false, deprecatedAt: null, deprecatedReason: null, createdAt: '' },
    ] });
    dbService.getStats.mockReturnValue({ concepts: { total: 0, tentative: 0, working: 0, established: 0 } });
    deriveFrameworkStateMock.mockReturnValue('zero_concepts');
    loadFromWorkspaceMock.mockReturnValue(createTestConfig({
      apiKeys: {
        anthropicApiKey: 'test-key',
        openaiApiKey: null,
        geminiApiKey: null,
        deepseekApiKey: null,
        semanticScholarApiKey: null,
        openalexEmail: null,
        unpaywallEmail: null,
        cohereApiKey: null,
        jinaApiKey: null,
        siliconflowApiKey: null,
        webSearchApiKey: null,
      },
    }));
    createLlmClientMock.mockReturnValue({
      complete: vi.fn(),
      getCostStats: vi.fn().mockReturnValue(null),
      resolveModel: vi.fn(),
    });

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await batchRun(makeArgs({ stage: 'analyze' }));

    expect(createAnalyzeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(createAnalyzeWorkflowMock.mock.calls[0]?.[0]?.frameworkState).toBe('framework_forming');

    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
  });
});