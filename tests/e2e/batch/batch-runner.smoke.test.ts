import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConfig } from '../../../src/__test-utils__/test-db';
import type { CliArgs } from '../../../src/cli/cli-entry';

const batchState = vi.hoisted(() => {
  const runnerStartCalls: Array<{ type: string; options: Record<string, unknown> }> = [];
  const dbService = {
    getStats: vi.fn(),
    getSuggestedConcepts: vi.fn(),
    close: vi.fn(async () => {}),
    walCheckpoint: vi.fn(async () => {}),
    raw: {},
  };

  return {
    runnerStartCalls,
    dbService,
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
    validateConfigMock: vi.fn(),
    renderSummaryMock: vi.fn(),
  };
});

vi.mock('../../../src/core/infra/logger', () => ({
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

vi.mock('../../../src/core/infra/config', () => ({
  ConfigLoader: {
    loadFromWorkspace: (...args: unknown[]) => batchState.loadFromWorkspaceMock(...args),
    load: (...args: unknown[]) => batchState.loadFromWorkspaceMock(...args),
  },
}));

vi.mock('../../../src/core/infra/global-config', () => ({
  loadGlobalConfig: (...args: unknown[]) => batchState.loadGlobalConfigMock(...args),
}));

vi.mock('../../../src/core/workspace', () => ({
  isWorkspace: (...args: unknown[]) => batchState.isWorkspaceMock(...args),
  scaffoldWorkspace: (...args: unknown[]) => batchState.scaffoldWorkspaceMock(...args),
  getWorkspacePaths: (...args: unknown[]) => batchState.getWorkspacePathsMock(...args),
}));

vi.mock('../../../src/core/database', () => ({
  createDatabaseService: (...args: unknown[]) => batchState.createDatabaseServiceMock(...args),
}));

vi.mock('../../../src/core/bibliography', () => ({
  createBibliographyService: (...args: unknown[]) => batchState.createBibliographyServiceMock(...args),
}));

vi.mock('../../../src/core/search', () => ({
  createSearchService: (...args: unknown[]) => batchState.createSearchServiceMock(...args),
}));

vi.mock('../../../src/core/acquire', () => ({
  AcquireService: class {
    constructor(_config: unknown, _logger: unknown) {}
  },
}));

vi.mock('../../../src/core/process', () => ({
  ProcessService: class {
    constructor(_config: unknown) {}
  },
}));

vi.mock('../../../src/electron/lock', () => ({
  acquireLock: (...args: unknown[]) => batchState.acquireLockMock(...args),
}));

vi.mock('../../../src/core/config/framework-state', () => ({
  deriveFrameworkState: vi.fn(() => 'working'),
}));

vi.mock('../../../src/core/config/config-validator', () => ({
  validateConfig: (...args: unknown[]) => batchState.validateConfigMock(...args),
}));

vi.mock('../../../src/core/config/hot-reload/concept-sync', () => ({
  syncConceptsFromYaml: vi.fn(() => ({ added: [], modified: [], deprecated: [], unchanged: [], renamed: [] })),
}));

vi.mock('../../../src/adapter/llm-client/llm-client', () => ({
  createLlmClient: (...args: unknown[]) => batchState.createLlmClientMock(...args),
}));

vi.mock('../../../src/adapter/llm-client/embed-function-factory', () => ({
  createEmbedFunction: vi.fn(() => ({ isAvailable: false })),
}));

vi.mock('../../../src/adapter/llm-client/reranker', () => ({
  RerankerScheduler: class {
    constructor(_configProvider: unknown, _logger: unknown) {}
  },
}));

vi.mock('../../../src/core/rag', () => ({
  createRagService: (...args: unknown[]) => batchState.createRagServiceMock(...args),
}));

vi.mock('../../../src/adapter/context-budget/context-budget-manager', () => ({
  createContextBudgetManager: (...args: unknown[]) => batchState.createContextBudgetManagerMock(...args),
}));

vi.mock('../../../src/adapter/orchestrator/workflows/discover', () => ({
  createDiscoverWorkflow: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/adapter/orchestrator/workflows/acquire', () => ({
  createAcquireWorkflow: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/adapter/orchestrator/workflows/process', () => ({
  createProcessWorkflow: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/adapter/orchestrator/workflows/analyze', () => ({
  createAnalyzeWorkflow: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/adapter/orchestrator/workflows/synthesize', () => ({
  createSynthesizeWorkflow: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/adapter/orchestrator/workflows/bibliography', () => ({
  createBibliographyWorkflow: vi.fn(() => vi.fn()),
}));

vi.mock('../../../src/adapter/orchestrator/concurrency-guard', () => ({
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

vi.mock('../../../src/adapter/orchestrator/error-classifier', () => ({
  CircuitBreakerTripped: class CircuitBreakerTripped extends Error {
    consecutiveFailures = 3;
    category = 'http_error';
  },
}));

vi.mock('../../../src/cli/progress-renderer', () => ({
  renderSummary: (...args: unknown[]) => batchState.renderSummaryMock(...args),
}));

vi.mock('../../../src/core/infra/config-provider', () => ({
  ConfigProvider: class {
    constructor(public config: unknown) {}
  },
}));

import { WorkflowRunner } from '../../../src/adapter/orchestrator/workflow-runner';
import { batchRun } from '../../../src/cli/batch-runner';

function makeArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    stage: 'all',
    paperIds: ['paper-1'],
    filter: null,
    conceptIds: [],
    workspace: 'C:/tmp/abyssal-smoke',
    configPath: null,
    concurrency: 0,
    dryRun: true,
    verbose: false,
    articleId: null,
    ...overrides,
  };
}

describe('batch runner smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchState.runnerStartCalls.length = 0;
    vi.spyOn(WorkflowRunner.prototype, 'start').mockImplementation((type: string, options: Record<string, unknown>) => {
      batchState.runnerStartCalls.push({ type, options });
      return {
        completionPromise: Promise.resolve({
          status: 'completed',
          progress: {
            totalItems: 1,
            completedItems: 1,
            failedItems: 0,
            skippedItems: 0,
            errors: [],
          },
        }),
      } as never;
    });

    batchState.acquireLockMock.mockReturnValue({ release: vi.fn() });
    batchState.isWorkspaceMock.mockReturnValue(true);
    batchState.scaffoldWorkspaceMock.mockReturnValue(undefined);
    batchState.getWorkspacePathsMock.mockReturnValue({ logs: 'C:/tmp/abyssal-smoke/logs' });
    batchState.loadGlobalConfigMock.mockReturnValue({});
    batchState.loadFromWorkspaceMock.mockReturnValue(createTestConfig({
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
        doubaoApiKey: null,
        kimiApiKey: null,
        webSearchApiKey: null,
      },
    }));
    batchState.dbService.getStats.mockReturnValue({ concepts: { total: 2, tentative: 1, working: 1, established: 0 } });
    batchState.dbService.getSuggestedConcepts.mockReturnValue([]);
    batchState.createDatabaseServiceMock.mockReturnValue(batchState.dbService);
    batchState.createBibliographyServiceMock.mockReturnValue({});
    batchState.createSearchServiceMock.mockReturnValue({});
    batchState.createLlmClientMock.mockReturnValue(null);
    batchState.createRagServiceMock.mockReturnValue(null);
    batchState.createContextBudgetManagerMock.mockReturnValue({});
    batchState.validateConfigMock.mockReturnValue({ warnings: [], frameworkState: 'working', concepts: [] });
    batchState.renderSummaryMock.mockReturnValue('smoke-summary');
  });

  it('runs discover and analyze as isolated headless stages with dry-run forwarded into workflow options', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await batchRun(makeArgs({ stage: 'discover', dryRun: true }));
    await batchRun(makeArgs({ stage: 'analyze', dryRun: true }));

    expect(batchState.runnerStartCalls.map((call) => call.type)).toEqual(['discover', 'analyze']);
    expect(batchState.runnerStartCalls.every((call) => call.options['dryRun'] === true)).toBe(true);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('── Stage: discover'));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('── Stage: analyze'));

    stderrWrite.mockRestore();
  });

  it('runs all documented stages in order and renders a diagnosable summary without exiting the process', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as unknown) as typeof process.exit);

    await batchRun(makeArgs({ stage: 'all', dryRun: true }));

    expect(batchState.runnerStartCalls.map((call) => call.type)).toEqual([
      'discover',
      'acquire',
      'process',
      'analyze',
      'synthesize',
      'article',
      'bibliography',
    ]);
    expect(stdoutWrite).toHaveBeenCalledWith('smoke-summary\n');
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Stage bibliography: completed (1/1)'));
    expect(exitSpy).not.toHaveBeenCalled();

    stderrWrite.mockRestore();
    stdoutWrite.mockRestore();
    exitSpy.mockRestore();
  });
});