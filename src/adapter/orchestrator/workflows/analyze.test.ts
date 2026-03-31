import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnalyzeWorkflow, type AnalyzeServices } from './analyze';
import type { WorkflowRunnerContext, WorkflowOptions, WorkflowProgress } from '../workflow-runner';

// ─── Mock services ───

function makeServices(overrides: Partial<AnalyzeServices> = {}): AnalyzeServices {
  return {
    dbProxy: {
      queryPapers: vi.fn().mockResolvedValue({ items: [] }),
      getPaper: vi.fn().mockResolvedValue({
        id: 'a1b2c3d4e5f6',
        title: 'Test Paper',
        abstract: 'Test abstract about affordance theory.',
        fulltextStatus: 'available',
        analysisStatus: 'not_started',
      }),
      updatePaper: vi.fn().mockResolvedValue(undefined),
      getAllConcepts: vi.fn().mockResolvedValue([]),
      getMemosByEntity: vi.fn().mockResolvedValue([]),
      getAnnotations: vi.fn().mockResolvedValue([]),
      mapPaperConcept: vi.fn().mockResolvedValue(undefined),
      addSuggestedConcept: vi.fn().mockResolvedValue(undefined),
      getConcept: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ concepts: { total: 0, tentative: 0, working: 0, established: 0 } }),
    } as unknown as AnalyzeServices['dbProxy'],
    llmClient: {
      complete: vi.fn().mockResolvedValue({
        text: '---\nconcept_mappings: []\nsuggested_new_concepts:\n  - term: "social presence"\n    reason: "Key construct"\n---\nAnalysis body.',
        usage: { inputTokens: 1000, outputTokens: 500 },
        reasoning: null,
      }),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200_000),
    } as unknown as AnalyzeServices['llmClient'],
    contextBudgetManager: {
      allocate: vi.fn().mockReturnValue({
        strategy: 'focused',
        totalBudget: 40000,
        outputReserve: 4096,
        sourceAllocations: new Map([
          ['paper_fulltext', { budgetTokens: 30000, actualTokens: 100, included: true, truncatedTo: null }],
          ['researcher_memos', { budgetTokens: 100, actualTokens: 100, included: true, truncatedTo: null }],
          ['researcher_annotations', { budgetTokens: 100, actualTokens: 100, included: true, truncatedTo: null }],
          ['concept_framework', { budgetTokens: 100, actualTokens: 100, included: true, truncatedTo: null }],
        ]),
        ragTopK: 10,
        skipReranker: false,
        skipQueryExpansion: false,
        truncated: false,
        truncationDetails: [],
      }),
    } as unknown as AnalyzeServices['contextBudgetManager'],
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    frameworkState: 'zero_concepts',
    workspacePath: '/tmp/test-workspace',
    ...overrides,
  };
}

function makeRunnerContext(): WorkflowRunnerContext {
  const progress: WorkflowProgress = {
    totalItems: 0, completedItems: 0, failedItems: 0, skippedItems: 0,
    currentItem: null, currentStage: null, errors: [], qualityWarnings: [], substeps: [],
    estimatedRemainingMs: null,
  };
  return {
    signal: new AbortController().signal,
    progress,
    reportProgress: vi.fn(),
    reportComplete: vi.fn(),
    reportFailed: vi.fn(),
    reportSkipped: vi.fn(),
    reportQualityWarning: vi.fn((itemId, type, message) => {
      progress.qualityWarnings.push({ itemId, type, message, timestamp: new Date().toISOString() });
    }),
    setTotal: vi.fn((n) => { progress.totalItems = n; }),
  };
}

describe('analyze workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fs for the tests
    vi.mock('node:fs', () => ({
      readFileSync: vi.fn().mockReturnValue('Full text of the paper...'),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
  });

  it('processes papers with specified paperIds', async () => {
    const services = makeServices();
    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.setTotal).toHaveBeenCalledWith(1);
    expect(services.llmClient.complete).toHaveBeenCalled();
    expect(ctx.reportComplete).toHaveBeenCalledWith('a1b2c3d4e5f6');
  });

  it('skips already-analyzed papers (idempotent resume)', async () => {
    const services = makeServices();
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6',
      analysisStatus: 'completed',
      fulltextStatus: 'available',
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportSkipped).toHaveBeenCalledWith('a1b2c3d4e5f6');
    expect(services.llmClient.complete).not.toHaveBeenCalled();
  });

  it('extracts suggested_new_concepts and writes to DB', async () => {
    const services = makeServices();
    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(services.dbProxy.addSuggestedConcept).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'social presence' }),
    );
  });

  it('single paper failure does not abort workflow', async () => {
    const services = makeServices();
    let callCount = 0;
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      callCount++;
      if (callCount === 1) throw new Error('DB error');
      return {
        id, title: 'Paper 2', abstract: '', fulltextStatus: 'available', analysisStatus: 'not_started',
      };
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['bad_paper', 'good_paper'] }, ctx);

    expect(ctx.reportFailed).toHaveBeenCalledTimes(1);
    expect(ctx.reportComplete).toHaveBeenCalledTimes(1);
  });

  it('uses zero-concept system prompt when frameworkState is zero_concepts', async () => {
    const services = makeServices({ frameworkState: 'zero_concepts' });
    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    // Check the system prompt passed to LLM contains zero-concept indicators
    const callArgs = (services.llmClient.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArgs.systemPrompt).toContain('no conceptual framework');
  });

  it('worker pool respects concurrency limit', async () => {
    const services = makeServices();
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
      return {
        text: '---\nconcept_mappings: []\n---\nBody.',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    const paperIds = Array.from({ length: 10 }, (_, i) => `paper_${String(i).padStart(12, '0')}`);

    await workflow({ paperIds, concurrency: 3 }, ctx);

    expect(peakConcurrent).toBeLessThanOrEqual(3);
  });

  it('reports quality warning when RAG retrieval fails', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
      ragService: {
        retrieve: vi.fn().mockRejectedValue(new Error('Embedding API down')),
      } as any,
    });
    // Need concepts for full analysis mode
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nameEn: 'Test', definition: 'A test', maturity: 'working', searchKeywords: ['test'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'high',
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportQualityWarning).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      'rag_degraded',
      expect.stringContaining('RAG retrieval failed'),
    );
  });

  it('reports quality warning when RAG coverage is partial', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
      ragService: {
        retrieve: vi.fn().mockResolvedValue({
          passages: [{ text: 'some text', paperId: 'other', score: 0.5 }],
          qualityReport: { coverage: 'partial', retryCount: 1, gaps: ['missing methods section'] },
        }),
      } as any,
    });
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nameEn: 'Test', definition: 'A test', maturity: 'working', searchKeywords: ['test'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'high',
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportQualityWarning).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      'rag_degraded',
      expect.stringContaining('partial'),
    );
  });

  it('uses completeAnalysis for atomic result write when available', async () => {
    const completeAnalysis = vi.fn().mockResolvedValue(undefined);
    const services = makeServices({
      frameworkState: 'framework_forming',
    });
    (services.dbProxy as any).completeAnalysis = completeAnalysis;
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nameEn: 'Test', definition: 'A test', maturity: 'working', searchKeywords: ['test'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'high',
    });
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '---\nconcept_mappings:\n  - concept_id: c1\n    relation: related\n    confidence: 0.8\n    evidence:\n      en: "evidence"\n---\nBody.',
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(completeAnalysis).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      expect.any(Array),
      'completed',
    );
    // mapPaperConcept should NOT be called separately when completeAnalysis succeeds
    expect(services.dbProxy.mapPaperConcept).not.toHaveBeenCalled();
  });
});
