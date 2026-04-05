import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnalyzeWorkflow, type AnalyzeServices } from './analyze';
import type { WorkflowRunnerContext, WorkflowProgress } from '../workflow-runner';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

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
      mapPaperConceptBatch: vi.fn().mockResolvedValue(undefined),
      addSuggestedConcept: vi.fn().mockResolvedValue(undefined),
      getConcept: vi.fn().mockResolvedValue(null),
      getStats: vi.fn().mockResolvedValue({ concepts: { total: 0, tentative: 0, working: 0, established: 0 } }),
      completeAnalysis: vi.fn().mockResolvedValue(undefined),
    } as unknown as AnalyzeServices['dbProxy'],
    llmClient: {
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: 'Analysis summary',
          analysis_markdown: 'Analysis body.',
          concept_mappings: [],
          suggested_new_concepts: [
            {
              term: 'social presence',
              frequency_in_paper: 2,
              closest_existing: null,
              reason: 'Key construct',
              suggested_definition: null,
              suggested_keywords: null,
            },
          ],
        }),
        usage: { inputTokens: 1000, outputTokens: 500 },
        reasoning: null,
      }),
      countTokens: vi.fn().mockReturnValue(100),
      getContextWindow: vi.fn().mockReturnValue(200_000),
      resolveModel: vi.fn((workflowId?: string) => workflowId === 'analyze.intermediate' ? 'deepseek-chat' : 'claude-sonnet-4'),
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

function makeRunnerContext(signal: AbortSignal = new AbortController().signal): WorkflowRunnerContext {
  const progress: WorkflowProgress = {
    totalItems: 0, completedItems: 0, failedItems: 0, skippedItems: 0,
    currentItem: null, currentStage: null, errors: [], qualityWarnings: [], substeps: [],
    estimatedRemainingMs: null,
  };
  return {
    signal,
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
  });

  it('requeues stale in_progress papers into the current batch', async () => {
    const services = makeServices();
    (services.dbProxy.queryPapers as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ items: [{ id: 'stale-paper' }] })
      .mockResolvedValueOnce({ items: [{ id: 'fresh-paper' }] });
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'fresh-paper',
      title: 'Fresh Paper',
      abstract: '',
      fulltextStatus: 'available',
      analysisStatus: 'not_started',
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({}, ctx);

    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith('stale-paper', { analysisStatus: 'not_started' });
    expect(services.dbProxy.queryPapers).toHaveBeenNthCalledWith(2, {
      analysisStatus: ['not_started', 'failed', 'needs_review'],
      fulltextStatus: ['available'],
      limit: 1000,
    });
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

  it('does not persist suggested concepts when autoSuggestConcepts is disabled', async () => {
    const services = makeServices({
      frameworkState: 'zero_concepts',
      analysisConfig: { autoSuggestConcepts: false },
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(services.dbProxy.addSuggestedConcept).not.toHaveBeenCalled();
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
    expect(callArgs.systemPrompt).toContain('has not yet defined a conceptual framework');
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
        text: JSON.stringify({
          summary: 'Summary',
          analysis_markdown: 'Body.',
          concept_mappings: [],
          suggested_new_concepts: [],
        }),
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
      text: JSON.stringify({
        summary: 'Summary',
        analysis_markdown: 'Body.',
        concept_mappings: [
          {
            concept_id: 'c1',
            relation: 'related',
            confidence: 0.8,
            evidence: {
              en: 'evidence',
              original: 'evidence',
              original_lang: 'en',
              chunk_id: null,
              page: null,
              annotation_id: null,
            },
          },
        ],
        suggested_new_concepts: [],
      }),
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

  it('flags concept mappings as stale when keywords change after the batch snapshot', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
    });
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        {
          id: 'c1',
          nameEn: 'Social Presence',
          nameZh: '社会临场感',
          definition: 'Shared sense of being with others',
          maturity: 'working',
          searchKeywords: ['presence'],
          parentId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          nameEn: 'Social Presence',
          nameZh: '社会临场感',
          definition: 'Shared sense of being with others',
          maturity: 'working',
          searchKeywords: ['presence', 'co-presence'],
          parentId: null,
        },
      ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6',
      title: 'Test Paper',
      abstract: 'Test abstract',
      fulltextStatus: 'available',
      analysisStatus: 'not_started',
      relevance: 'high',
    });
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        summary: 'Summary',
        analysis_markdown: 'Body.',
        concept_mappings: [
          {
            concept_id: 'c1',
            relation: 'related',
            confidence: 0.8,
            evidence: {
              en: 'evidence',
              original: 'evidence',
              original_lang: 'en',
              chunk_id: null,
              page: null,
              annotation_id: null,
            },
          },
        ],
        suggested_new_concepts: [],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
      reasoning: null,
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportQualityWarning).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      'concept_stale',
      expect.stringContaining('Concept framework was modified during batch analysis'),
    );
  });

  it('passes the routed frontier model into full analysis LLM calls', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
      modelRouterConfig: { frontierModel: 'gpt-4o', lowCostModel: 'deepseek-chat' },
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

    expect(services.llmClient.complete).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'analyze.full',
      model: 'gpt-4o',
    }));
  });

  it('normalizes suggested closest_existing names to concept ids', async () => {
    const services = makeServices({ frameworkState: 'framework_forming' });
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'social_presence', nameEn: 'Social Presence', nameZh: '社会临场感', definition: 'A test', maturity: 'working', searchKeywords: ['presence'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'high',
    });
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: JSON.stringify({
        summary: 'Summary',
        analysis_markdown: 'Body.',
        concept_mappings: [],
        suggested_new_concepts: [
          {
            term: 'copresence',
            frequency_in_paper: 1,
            closest_existing: 'Social Presence',
            reason: 'Related construct',
            suggested_definition: null,
            suggested_keywords: null,
          },
        ],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
      reasoning: null,
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(services.dbProxy.addSuggestedConcept).toHaveBeenCalledWith(expect.objectContaining({
      closestExistingConceptId: 'social_presence',
    }));
  });

  it('stores successful intermediate analysis using legal paper statuses', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
      modelRouterConfig: { frontierModel: 'claude-opus-4', lowCostModel: 'deepseek-chat' },
    });
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nameEn: 'Test', definition: 'A test', maturity: 'working', searchKeywords: ['test'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'medium',
    });
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: '{"paper_type":"journal","core_claims":[{"claim":"Claim","evidence_type":"empirical","strength":"strong"}],"method_summary":"Method summary","key_concepts":["presence"],"potential_relevance":0.4,"recommend_deep_analysis":false}',
      usage: { inputTokens: 100, outputTokens: 50 },
      reasoning: null,
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();
    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(services.llmClient.complete).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'analyze.intermediate',
      model: 'deepseek-chat',
    }));
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      expect.objectContaining({ analysisStatus: 'completed' }),
    );
  });

  it('reports parse failures as failed items instead of completed items', async () => {
    const services = makeServices();
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'not valid yaml or json',
      usage: { inputTokens: 100, outputTokens: 50 },
      reasoning: null,
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportFailed).toHaveBeenCalledTimes(1);
    expect(ctx.reportComplete).not.toHaveBeenCalled();
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      expect.objectContaining({ analysisStatus: 'failed', failureReason: 'parse_failed' }),
    );
  });

  it('restores previous status and avoids completion when analysis is cancelled', async () => {
    const controller = new AbortController();
    const services = makeServices();
    (services.llmClient.complete as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      controller.abort();
      const error = new Error('Request cancelled');
      error.name = 'AbortError';
      throw error;
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext(controller.signal);

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportComplete).not.toHaveBeenCalled();
    expect(ctx.reportFailed).not.toHaveBeenCalled();
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith('a1b2c3d4e5f6', { analysisStatus: 'in_progress' });
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith('a1b2c3d4e5f6', { analysisStatus: 'not_started' });
  });

  it('reports context truncation as a quality warning', async () => {
    const services = makeServices({
      contextBudgetManager: {
        allocate: vi.fn().mockReturnValue({
          strategy: 'focused',
          totalBudget: 40000,
          outputReserve: 4096,
          sourceAllocations: new Map([
            ['paper_fulltext', { budgetTokens: 15000, actualTokens: 30000, included: true, truncatedTo: 15000 }],
          ]),
          ragTopK: 10,
          skipReranker: false,
          skipQueryExpansion: false,
          truncated: true,
          truncationDetails: [
            { sourceType: 'paper_fulltext', originalTokens: 30000, truncatedTo: 15000 },
          ],
        }),
      } as unknown as AnalyzeServices['contextBudgetManager'],
    });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportQualityWarning).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      'context_truncated',
      expect.stringContaining('paper_fulltext 30000->15000'),
    );
  });

  it('defers completion until upgraded full analysis finishes', async () => {
    const services = makeServices({
      frameworkState: 'framework_forming',
      modelRouterConfig: { frontierModel: 'claude-opus-4', lowCostModel: 'deepseek-chat' },
    });
    (services.dbProxy.getAllConcepts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'c1', nameEn: 'Test', definition: 'A test', maturity: 'working', searchKeywords: ['test'] },
    ]);
    (services.dbProxy.getPaper as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'a1b2c3d4e5f6', title: 'Test Paper', abstract: 'Test abstract',
      fulltextStatus: 'available', analysisStatus: 'not_started', relevance: 'medium',
    });
    (services.llmClient.complete as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        text: '{"paper_type":"journal","core_claims":[{"claim":"Claim","evidence_type":"empirical","strength":"strong"}],"method_summary":"Method summary","key_concepts":["presence"],"potential_relevance":0.9,"recommend_deep_analysis":true}',
        usage: { inputTokens: 100, outputTokens: 50 },
        reasoning: null,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'Summary',
          analysis_markdown: 'Body.',
          concept_mappings: [],
          suggested_new_concepts: [],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
        reasoning: null,
      });

    const workflow = createAnalyzeWorkflow(services);
    const ctx = makeRunnerContext();

    await workflow({ paperIds: ['a1b2c3d4e5f6'] }, ctx);

    expect(ctx.reportComplete).toHaveBeenCalledTimes(1);
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      expect.objectContaining({ analysisStatus: 'needs_review' }),
    );
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith(
      'a1b2c3d4e5f6',
      expect.objectContaining({ analysisStatus: 'not_started', failureReason: null }),
    );
  });
});
