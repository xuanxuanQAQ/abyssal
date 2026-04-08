import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assessExtractedTextQuality,
  createProcessWorkflow,
  isProcessFailureReason,
  shouldQueuePaperForProcessing,
  type ProcessServices,
} from './process';
import type { WorkflowProgress, WorkflowRunnerContext } from '../workflow-runner';

describe('isProcessFailureReason', () => {
  it('recognizes known process failure reasons', () => {
    expect(isProcessFailureReason('rag_service_unavailable')).toBe(true);
    expect(isProcessFailureReason('vector_indexing_failed')).toBe(true);
    expect(isProcessFailureReason('section_detection_degraded')).toBe(true);
  });

  it('ignores unknown or empty reasons', () => {
    expect(isProcessFailureReason(null)).toBe(false);
    expect(isProcessFailureReason('some_other_reason')).toBe(false);
  });
});

describe('shouldQueuePaperForProcessing', () => {
  it('queues papers without extracted text', () => {
    expect(shouldQueuePaperForProcessing({ fulltextPath: 'paper.pdf', textPath: null, failureReason: null })).toBe(true);
  });

  it('queues papers with persisted process failures', () => {
    expect(shouldQueuePaperForProcessing({
      fulltextPath: 'paper.pdf',
      textPath: 'texts/paper.txt',
      failureReason: 'rag_service_unavailable',
    })).toBe(true);
  });

  it('does not queue fully processed papers without failure markers', () => {
    expect(shouldQueuePaperForProcessing({
      fulltextPath: 'paper.pdf',
      textPath: 'texts/paper.txt',
      failureReason: null,
    })).toBe(false);
  });
});

describe('assessExtractedTextQuality', () => {
  it('flags very short extracted text', () => {
    const quality = assessExtractedTextQuality('too short');
    expect(quality.isTooShort).toBe(true);
  });

  it('flags suspiciously repetitive low-information text', () => {
    const repetitive = Array.from({ length: 30 }, () => '........').join('\n');
    const quality = assessExtractedTextQuality(repetitive);

    expect(quality.isLowQuality).toBe(true);
  });
});

function makeRunnerContext(): WorkflowRunnerContext {
  const progress: WorkflowProgress = {
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    currentItem: null,
    currentStage: null,
    errors: [],
    qualityWarnings: [],
    substeps: [],
    estimatedRemainingMs: null,
    currentItemLabel: null,
  };

  return {
    signal: new AbortController().signal,
    progress,
    workflowId: 'test-workflow-id',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    pushStreamChunk: vi.fn(),
    reportProgress: vi.fn(),
    reportComplete: vi.fn(),
    reportFailed: vi.fn(),
    reportSkipped: vi.fn(),
    reportQualityWarning: vi.fn(),
    setTotal: vi.fn((total) => {
      progress.totalItems = total;
    }),
  };
}

function makeExtractTextResult() {
  const fullText = [
    '摘要',
    '这是一段足够长的正文内容，用于验证处理流程会进入分块和索引阶段。'.repeat(20),
    '参考文献',
    '[1] 张三. 示例文献[J]. 2024.',
  ].join('\n');

  return {
    fullText,
    pageCount: 1,
    method: 'mupdf',
    charCount: fullText.length,
    estimatedTokenCount: 1200,
    ocrConfidence: null,
    scannedPageIndices: [],
    ocrPageLines: [],
    pdfMetadata: null,
    firstPage: null,
    pageCharData: [],
    styledLines: [],
    pageTexts: [fullText],
  };
}

function makeServices(workspacePath: string, overrides: Partial<ProcessServices> = {}): ProcessServices {
  return {
    dbProxy: {
      queryPapers: vi.fn().mockResolvedValue({ items: [] }),
      getPaper: vi.fn().mockResolvedValue({
        id: 'paper-1',
        title: 'Test Paper',
        authors: [],
        fulltextStatus: 'available',
        fulltextPath: 'paper.pdf',
        textPath: null,
        failureReason: null,
      }),
      updatePaper: vi.fn().mockResolvedValue(undefined),
    },
    processService: {
      extractText: vi.fn().mockResolvedValue(makeExtractTextResult()),
      extractSections: vi.fn().mockReturnValue({
        sectionMap: new Map([
          ['abstract', '摘要'],
          ['introduction', '引言'],
          ['references', '参考文献'],
        ]),
        boundaries: [{ title: '摘要', label: 'abstract', depth: 1 }],
      }),
      chunkText: vi.fn().mockReturnValue([
        { id: 'chunk-1', text: 'chunk-1', tokenCount: 120 },
        { id: 'chunk-2', text: 'chunk-2', tokenCount: 110 },
        { id: 'chunk-3', text: 'chunk-3', tokenCount: 105 },
      ]),
      extractReferences: vi.fn().mockReturnValue([
        { title: '示例文献', authors: ['张三'], year: 2024 },
      ]),
      extractSectionsFromLayout: vi.fn(),
      chunkTextFromLayout: vi.fn(),
      extractReferencesFromLayout: vi.fn(),
    } as unknown as NonNullable<ProcessServices['processService']>,
    ragService: {
      embedAndIndexChunks: vi.fn().mockResolvedValue(undefined),
    },
    bibliographyService: null,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
    workspacePath,
    hydrateConfig: {
      enableApiLookup: false,
      enableLlmExtraction: false,
    },
    llmCallFn: null,
    lookupService: null,
    enrichService: null,
    hydratePersist: null,
    ...overrides,
  };
}

describe('process workflow failure semantics', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'abyssal-process-'));
    await fs.writeFile(path.join(workspacePath, 'paper.pdf'), 'fake-pdf');
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it('marks rag_service_unavailable as a workflow failure instead of completing', async () => {
    const services = makeServices(workspacePath, { ragService: null });
    const workflow = createProcessWorkflow(services);
    const runner = makeRunnerContext();

    await workflow({ paperIds: ['paper-1'], concurrency: 1 }, runner);

    expect(runner.reportFailed).toHaveBeenCalledWith(
      'paper-1',
      'indexing',
      expect.objectContaining({ message: 'rag_service_unavailable' }),
    );
    expect(runner.reportComplete).not.toHaveBeenCalled();
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith('paper-1', expect.objectContaining({
      failureReason: 'rag_service_unavailable',
      textPath: expect.stringContaining('paper-1.txt'),
    }));
  });

  it('resolves ragService lazily at execution time', async () => {
    let currentRagService: ProcessServices['ragService'] = null;
    const services = makeServices(workspacePath, {
      ragService: null,
      getRagService: () => currentRagService,
    });
    const workflow = createProcessWorkflow(services);
    const runner = makeRunnerContext();

    currentRagService = {
      embedAndIndexChunks: vi.fn().mockResolvedValue(undefined),
    };

    await workflow({ paperIds: ['paper-1'], concurrency: 1 }, runner);

    expect(currentRagService.embedAndIndexChunks).toHaveBeenCalledTimes(1);
    expect(runner.reportComplete).toHaveBeenCalledWith('paper-1');
    expect(runner.reportFailed).not.toHaveBeenCalled();
    expect(services.dbProxy.updatePaper).toHaveBeenCalledWith('paper-1', expect.objectContaining({
      failureReason: null,
    }));
  });
});