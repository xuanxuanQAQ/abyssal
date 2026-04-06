/**
 * Process workflow — text extraction → hydration → chunking → vector indexing.
 *
 * Decoupled from the acquire pipeline so it can run independently on papers
 * that already have a PDF but haven't been through post-processing.
 *
 * Steps:
 * 3.  Text extraction with OCR fallback (§2.5)
 * 3c. Metadata hydration (multi-source)
 * 4.  Section structure recognition (§2.6.1)
 * 5.  Structure-aware chunking (§2.6.2)
 * 6-7. Embedding + vector indexing (§2.7)
 * 8.  Reference extraction + persistence (§2.8)
 * 9.  Bibliography enrichment (§2.9)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext, WorkflowSubstep } from '../workflow-runner';
import type { ProcessService, PdfEmbeddedMetadata, FirstPageMetadata, ExtractedReference } from '../../../core/process';
import type { Logger } from '../../../core/infra/logger';
import type { PaperMetadata } from '../../../core/types/paper';
import type { ContentBlock } from '../../../core/dla/types';
import { runFusionPipeline } from '../../../core/dla/fusion';
import type { HydrateConfig, MetadataLookupService, EnrichService, LlmCallFn } from '../../../core/hydrate';
import { hydratePaperMetadata } from '../../../core/hydrate';
import { PaperNotFoundError } from '../../../core/types/errors';
import { createConcurrencyGuard } from '../concurrency-guard';
import { paperField } from '../utils';
import { resolveCurrentRagService } from './rag-service-resolver';

const PROCESS_FAILURE_CODES = new Set([
  'process_service_unavailable',
  'text_extraction_failed',
  'extracted_text_too_short',
  'extracted_text_low_quality',
  'section_detection_degraded',
  'chunking_degraded',
  'no_chunks_produced',
  'vector_indexing_failed',
  'rag_service_unavailable',
  'reference_extraction_failed',
  'no_references_extracted',
]);

const PROCESS_FAILURE_PRIORITY = [
  'process_service_unavailable',
  'text_extraction_failed',
  'extracted_text_too_short',
  'extracted_text_low_quality',
  'section_detection_degraded',
  'chunking_degraded',
  'no_chunks_produced',
  'vector_indexing_failed',
  'rag_service_unavailable',
  'reference_extraction_failed',
  'no_references_extracted',
] as const;

interface TextQualityDiagnostics {
  isTooShort: boolean;
  isLowQuality: boolean;
  charCount: number;
  nonEmptyLineCount: number;
  avgNonEmptyLineLength: number;
  informativeCharRatio: number;
  uniqueLineRatio: number;
}

function primaryFailureCode(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.split(':', 1)[0]?.trim() ?? null;
}

export function isRetryableProcessFailure(reason: string | null | undefined): boolean {
  const code = primaryFailureCode(reason);
  return code != null && PROCESS_FAILURE_CODES.has(code);
}

export function isProcessFailureReason(reason: string | null | undefined): boolean {
  return isRetryableProcessFailure(reason);
}

function stageForProcessFailure(reason: string | null | undefined): string {
  switch (primaryFailureCode(reason)) {
    case 'process_service_unavailable':
    case 'text_extraction_failed':
    case 'extracted_text_too_short':
    case 'extracted_text_low_quality':
      return 'text-extraction';
    case 'section_detection_degraded':
      return 'sectioning';
    case 'chunking_degraded':
    case 'no_chunks_produced':
      return 'chunking';
    case 'vector_indexing_failed':
    case 'rag_service_unavailable':
      return 'indexing';
    case 'reference_extraction_failed':
    case 'no_references_extracted':
      return 'references';
    default:
      return 'process';
  }
}

export function shouldQueuePaperForProcessing(paper: Record<string, unknown>): boolean {
  const hasFulltext = !!paperField<string | null>(paper, 'fulltextPath', null);
  const hasText = !!paperField<string | null>(paper, 'textPath', null);
  const failureReason = paperField<string | null>(paper, 'failureReason', null);
  if (!hasFulltext) return false;
  if (!hasText) return true;
  return isProcessFailureReason(failureReason);
}

function selectPrimaryProcessFailureReason(issues: string[]): string | null {
  for (const code of PROCESS_FAILURE_PRIORITY) {
    if (issues.includes(code)) return code;
  }
  return issues[0] ?? null;
}

export function assessExtractedTextQuality(fullText: string): TextQualityDiagnostics {
  const nonWhitespace = fullText.replace(/\s+/g, '');
  const nonEmptyLines = fullText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const informativeCharPattern = /[\p{L}\p{N}]/gu;
  const informativeChars = (nonWhitespace.match(informativeCharPattern) ?? []).length;
  const uniqueLines = new Set(nonEmptyLines).size;
  const avgNonEmptyLineLength = nonEmptyLines.length > 0
    ? nonEmptyLines.reduce((sum, line) => sum + line.length, 0) / nonEmptyLines.length
    : 0;
  const informativeCharRatio = nonWhitespace.length > 0 ? informativeChars / nonWhitespace.length : 0;
  const uniqueLineRatio = nonEmptyLines.length > 0 ? uniqueLines / nonEmptyLines.length : 1;
  const isTooShort = nonWhitespace.length < 100;
  const isLowQuality = !isTooShort && (
    (nonWhitespace.length >= 1000 && informativeCharRatio < 0.45)
    || (nonEmptyLines.length >= 20 && uniqueLineRatio < 0.2)
    || (nonEmptyLines.length >= 5 && avgNonEmptyLineLength > 1200)
  );

  return {
    isTooShort,
    isLowQuality,
    charCount: nonWhitespace.length,
    nonEmptyLineCount: nonEmptyLines.length,
    avgNonEmptyLineLength: Number(avgNonEmptyLineLength.toFixed(2)),
    informativeCharRatio: Number(informativeCharRatio.toFixed(3)),
    uniqueLineRatio: Number(uniqueLineRatio.toFixed(3)),
  };
}

// ─── Helpers ───

class SubstepTracker {
  private readonly steps: string[];
  private readonly runner: WorkflowRunnerContext;

  constructor(steps: string[], runner: WorkflowRunnerContext) {
    this.steps = steps;
    this.runner = runner;
  }

  advance(currentStep: string, stage: string): void {
    const idx = this.steps.indexOf(currentStep);
    const substeps: WorkflowSubstep[] = this.steps.map((name, i) => ({
      name,
      status: i < idx ? 'success' as const : i === idx ? 'running' as const : 'pending' as const,
    }));
    this.runner.reportProgress({ currentStage: stage, substeps });
  }
}

// ─── Services interface ───

export interface ProcessServices {
  dbProxy: {
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getPaper: (id: string) => Promise<Record<string, unknown> | null>;
    updatePaper: (id: unknown, fields: unknown) => Promise<void>;
  };
  processService: ProcessService | null;
  ragService: {
    embedAndIndexChunks: (chunks: unknown[]) => Promise<unknown>;
  } | null;
  getRagService?: (() => ProcessServices['ragService']) | undefined;
  bibliographyService: {
    enrichBibliography: (paper: unknown) => Promise<unknown>;
  } | null;
  logger: Logger;
  workspacePath: string;
  hydrateConfig: HydrateConfig;
  llmCallFn: LlmCallFn | null;
  lookupService: MetadataLookupService | null;
  enrichService: EnrichService | null;
  hydratePersist: {
    upsertReferences: (paperId: string, refs: ExtractedReference[]) => void;
    insertHydrateLogs: (paperId: string, logs: Array<{ field: string; value: unknown; source: string }>) => void;
  } | null;
  /** Optional DLA analysis function — when provided, enables layout-aware processing. */
  dlaAnalyze?: ((pdfPath: string, pageCount: number) => Promise<ContentBlock[]>) | null;
  /** Optional layout block persistence — write TypedBlocks and section boundaries to DB. */
  layoutPersist?: {
    clearLayoutAnalysis: (paperId: string) => void;
    insertLayoutBlocks: (paperId: string, blocks: Array<Record<string, unknown>>) => void;
    insertSectionBoundaries: (paperId: string, boundaries: Array<Record<string, unknown>>) => void;
    hasLayoutBlocks: (paperId: string) => boolean;
  } | null;
  /** Optional OCR lines persistence — write line-level bbox data for scanned pages. */
  ocrLinesPersist?: {
    insertOcrLines: (lines: Array<Record<string, unknown>>) => void;
    deleteOcrLines: (paperId: string) => void;
  } | null;
}

// ─── Workflow ───

export function createProcessWorkflow(services: ProcessServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, logger } = services;
    const guard = createConcurrencyGuard('process', options.concurrency);

    const workflowStartTime = Date.now();
    logger.info('[ProcessWorkflow] Workflow function entered', { paperIds: options.paperIds });

    // Determine target papers: explicit paperIds, or query for papers with PDF but no textPath
    let paperIds = options.paperIds ?? [];
    logger.info('[ProcessWorkflow] Input paperIds', { paperIds, count: paperIds.length });
    if (paperIds.length === 0) {
      logger.info('[ProcessWorkflow] No paperIds provided, querying DB for unprocessed papers with PDF');
      const result = await dbProxy.queryPapers({
        fulltextStatus: ['available'],
        limit: 1000,
      });
      let missingTextCount = 0;
      let failedWithTextCount = 0;
      paperIds = result.items
        .filter((p) => {
          const hasText = !!paperField<string | null>(p, 'textPath', null);
          const failureReason = paperField<string | null>(p, 'failureReason', null);
          const shouldQueue = shouldQueuePaperForProcessing(p);
          if (shouldQueue) {
            if (!hasText) {
              missingTextCount++;
            } else if (isProcessFailureReason(failureReason)) {
              failedWithTextCount++;
            }
          }
          return shouldQueue;
        })
        .map((p) => p['id'] as string);
      logger.info('[ProcessWorkflow] Selected papers for processing', {
        count: paperIds.length,
        missingTextCount,
        failedWithTextCount,
      });
    }

    if (paperIds.length === 0) {
      logger.info('[ProcessWorkflow] No papers to process, returning');
      return;
    }

    runner.setTotal(paperIds.length);
    const concurrency = options.concurrency ?? 3;

    const queue = [...paperIds];
    const worker = async () => {
      while (!runner.signal.aborted) {
        const paperId = queue.shift();
        if (paperId === undefined) break;

        runner.reportProgress({ currentItem: paperId, currentStage: 'processing' });

        await guard.runWithSlot(async ({ writeExclusive }) => {
          try {
            const result = await processSinglePaper(paperId, { ...services, writeExclusive }, runner);
            if (result.failed) {
              runner.reportFailed(paperId, result.failedStage!, new Error(result.failReason!));
            } else {
              runner.reportComplete(paperId);
            }
          } catch (error) {
            logger.error(`[ProcessWorkflow] Failed: ${(error as Error).message}`, undefined, { paperId });
            runner.reportFailed(paperId, 'process', error as Error);
          }
        });
      }
    };

    await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));

    const p = runner.progress;
    logger.info('[ProcessWorkflow] Workflow complete', {
      succeeded: p.completedItems,
      failed: p.failedItems,
      total: p.totalItems,
      durationMs: Date.now() - workflowStartTime,
    });
  };
}

// ─── Single paper processing ───

interface SinglePaperResult {
  failed: boolean;
  failedStage?: string;
  failReason?: string;
}

async function processSinglePaper(
  paperId: string,
  ctx: ProcessServices & {
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
  runner?: WorkflowRunnerContext,
): Promise<SinglePaperResult> {
  const { dbProxy, logger, workspacePath, writeExclusive } = ctx;

  logger.info(`[process] processSinglePaper called for ${paperId}`);

  const paper = await dbProxy.getPaper(paperId);
  if (!paper) {
    throw new PaperNotFoundError({ message: `Paper not found: ${paperId}` });
  }

  const fulltextStatus = paperField<string | null>(paper, 'fulltextStatus', null);
  const fulltextPath = paperField<string | null>(paper, 'fulltextPath', null);
  const textPath = paperField<string | null>(paper, 'textPath', null);

  logger.info(`[process] Paper ${paperId} state`, { fulltextStatus, fulltextPath, textPath });

  if (!fulltextPath) {
    logger.warn(`[process] Paper ${paperId} has no fulltextPath, skipping`);
    return { failed: true, failedStage: 'pre-check', failReason: 'no fulltextPath' };
  }

  const resolvedPath = path.isAbsolute(fulltextPath)
    ? fulltextPath
    : path.join(workspacePath, fulltextPath);

  const fileExists = fs.existsSync(resolvedPath);
  logger.info(`[process] PDF path resolved for ${paperId}`, { resolvedPath, fileExists });

  if (!fileExists) {
    logger.warn(`[process] PDF not found for ${paperId}: ${resolvedPath}`);
    return { failed: true, failedStage: 'pre-check', failReason: `PDF not found: ${resolvedPath}` };
  }

  logger.info(`[process] Starting post-processing for ${paperId}`, { pdfPath: resolvedPath });

  const result = await processExtractAndHydrate(paperId, resolvedPath, paper, ctx, runner ? { runner } : undefined);
  const failed = !result.textPath || !!result.failureReason;

  await writeExclusive(async () => {
    await dbProxy.updatePaper(paperId, {
      ...result.hydratePatch,
      textPath: result.textPath,
      failureReason: result.failureReason,
    });
  });

  if (failed) {
    logger.warn(`[process] Paper ${paperId} processing failed`, {
      textPath: result.textPath,
      vectorIndexed: result.vectorIndexed,
      failureReason: result.failureReason,
    });
    return {
      failed: true,
      failedStage: stageForProcessFailure(result.failureReason),
      failReason: result.failureReason ?? 'text_extraction_failed',
    };
  }

  logger.info(`[process] Paper ${paperId} processing complete ✓`, {
    textPath: result.textPath,
    vectorIndexed: result.vectorIndexed,
  });
  return { failed: false };
}

// ─── Shared processing + hydration pipeline ───

interface ProcessResult {
  textPath: string | null;
  vectorIndexed: boolean;
  failureReason: string | null;
  hydratePatch: Partial<PaperMetadata>;
}

/**
 * Unified extraction + hydration pipeline.
 *
 * Steps: text extraction → hydration → section recognition →
 *        chunking → embedding → reference extraction → bibliography enrichment
 */
export async function processExtractAndHydrate(
  paperId: string,
  pdfPath: string,
  paper: Record<string, unknown>,
  ctx: ProcessServices & {
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
  opts?: { runner?: WorkflowRunnerContext },
): Promise<ProcessResult> {
  const { processService, logger, workspacePath } = ctx;
  let textPath: string | null = null;
  let vectorIndexed = false;
  let hydratePatch: Partial<PaperMetadata> = {};
  const tracker = opts?.runner ? new SubstepTracker(['extract', 'hydrate', 'dla', 'chunk', 'index'], opts.runner) : null;

  const pipelineStartTime = Date.now();
  let chunkCount = 0;
  let refCount = 0;
  const processIssues: string[] = [];

  const recordIssue = (issue: string, level: 'info' | 'warn' = 'warn', context?: Record<string, unknown>) => {
    if (!processIssues.includes(issue)) {
      processIssues.push(issue);
    }
    if (context) {
      logger[level](`[process] Diagnostic issue for ${paperId}: ${issue}`, context);
    }
  };

  if (processService) {
    logger.info(`[process] Steps 3-8: Starting text processing for ${paperId}`);

    // ══ Step 3: Text extraction (§2.5) ══
    const textDir = path.join(workspacePath, 'texts');
    await fs.promises.mkdir(textDir, { recursive: true });
    textPath = path.join(textDir, `${paperId}.txt`);

    const extractStartTime = Date.now();
    const extraction = await processService.extractText(pdfPath);
    const fullText = extraction.fullText ?? '';
    const textQuality = assessExtractedTextQuality(fullText);

    logger.info(`[process] Step 3: Text extraction complete for ${paperId}`, {
      pageCount: extraction.pageCount,
      method: extraction.method,
      charCount: extraction.charCount,
      estimatedTokens: extraction.estimatedTokenCount,
      ocrConfidence: extraction.ocrConfidence,
      scannedPages: extraction.scannedPageIndices.length,
      textQuality,
      durationMs: Date.now() - extractStartTime,
    });

    const textTooShort = textQuality.isTooShort;

    if (textQuality.isLowQuality) {
      recordIssue('extracted_text_low_quality', 'warn', {
        charCount: textQuality.charCount,
        nonEmptyLineCount: textQuality.nonEmptyLineCount,
        avgNonEmptyLineLength: textQuality.avgNonEmptyLineLength,
        informativeCharRatio: textQuality.informativeCharRatio,
        uniqueLineRatio: textQuality.uniqueLineRatio,
      });
    }

    // ══ Step 3a: Persist OCR line-level bbox for scanned pages ══
    if (ctx.ocrLinesPersist && extraction.ocrPageLines && extraction.ocrPageLines.length > 0) {
      try {
        ctx.ocrLinesPersist.deleteOcrLines(paperId);
        const ocrLineRows = extraction.ocrPageLines.flatMap((page) =>
          page.lines.map((line) => ({
            paperId,
            pageIndex: line.pageIndex,
            lineIndex: line.lineIndex,
            text: line.text,
            bbox: { x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h },
            confidence: line.confidence,
          })),
        );
        ctx.ocrLinesPersist.insertOcrLines(ocrLineRows);
        logger.info(`[process] Step 3a: Persisted OCR lines for ${paperId}`, {
          pages: extraction.ocrPageLines.length,
          totalLines: ocrLineRows.length,
        });
      } catch (err) {
        logger.debug(`Paper ${paperId}: OCR lines persistence failed`, { error: (err as Error).message });
      }
    }

    if (textTooShort) {
      recordIssue('extracted_text_too_short', 'warn', {
        charCount: textQuality.charCount,
        nonEmptyLineCount: textQuality.nonEmptyLineCount,
      });
      logger.warn(`Paper ${paperId}: extracted text too short (${fullText.length} chars), skipping chunking/indexing`);
    }

    // Write text file atomically (§5.2.3)
    const tmpTextPath = textPath + '.tmp';
    await fs.promises.writeFile(tmpTextPath, fullText, 'utf-8');
    await fs.promises.rename(tmpTextPath, textPath);
    logger.debug(`[process] Step 3: Text file written for ${paperId}`, {
      textPath, sizeBytes: Buffer.byteLength(fullText, 'utf-8'),
    });

    tracker?.advance('hydrate', 'hydrating');

    // ══ Step 3c: Metadata hydration ══
    const pdfMeta: PdfEmbeddedMetadata = extraction.pdfMetadata ?? {
      title: null, author: null, subject: null, keywords: null,
      creator: null, producer: null, creationDate: null,
    };
    const firstPage: FirstPageMetadata = extraction.firstPage ?? {
      titleCandidate: null, authorCandidates: [], firstPageText: '',
    };

    const paperForHydrate = {
      title: paperField<string | null>(paper, 'title', null),
      authors: paperField<string[]>(paper, 'authors', []),
      year: paperField<number | null>(paper, 'year', null),
      abstract: paperField<string | null>(paper, 'abstract', null),
      doi: paperField<string | null>(paper, 'doi', null),
      arxivId: paperField<string | null>(paper, 'arxivId', null),
      pmcid: paperField<string | null>(paper, 'pmcid', null),
      pmid: paperField<string | null>(paper, 'pmid', null),
      venue: paperField<string | null>(paper, 'venue', null),
      journal: paperField<string | null>(paper, 'journal', null),
      volume: paperField<string | null>(paper, 'volume', null),
      issue: paperField<string | null>(paper, 'issue', null),
      pages: paperField<string | null>(paper, 'pages', null),
      publisher: paperField<string | null>(paper, 'publisher', null),
      issn: paperField<string | null>(paper, 'issn', null),
      isbn: paperField<string | null>(paper, 'isbn', null),
      citationCount: paperField<number | null>(paper, 'citationCount', null),
      paperType: paperField(paper, 'paperType', 'unknown'),
    } as PaperMetadata;

    const hydrateStartTime = Date.now();
    try {
      logger.info(`[process] Step 3c: Running metadata hydration for ${paperId}`);
      const hydrateResult = await hydratePaperMetadata(paperForHydrate, pdfMeta, firstPage, {
        llmCall: ctx.llmCallFn,
        lookupService: ctx.lookupService,
        enrichService: ctx.enrichService,
        config: ctx.hydrateConfig,
        logger,
      });

      hydratePatch = hydrateResult.patch;

      if (ctx.hydratePersist && hydrateResult.result.fieldsUpdated.length > 0) {
        try {
          ctx.hydratePersist.insertHydrateLogs(paperId, hydrateResult.result.fieldsUpdated);
        } catch (err) {
          logger.debug(`Paper ${paperId}: hydrate log persistence failed`, { error: (err as Error).message });
        }
      }

      logger.info(`[process] Step 3c: Hydration complete for ${paperId}`, {
        fieldsUpdated: hydrateResult.result.fieldsUpdated.length,
        fieldsMissing: hydrateResult.result.fieldsMissing,
        hydratePatchKeys: Object.keys(hydratePatch),
        durationMs: Date.now() - hydrateStartTime,
      });
    } catch (err) {
      logger.warn(`[process] Step 3c: Metadata hydration failed (non-fatal)`, {
        paperId, error: (err as Error).message, durationMs: Date.now() - hydrateStartTime,
      });
    }

    // ══ Steps 3b-8: Skip if text too short ══
    if (!textTooShort) {
      tracker?.advance('dla', 'layout analysis');

      // ══ Step 3b: DLA layout analysis (optional) ══
      let dlaStructure: import('../../../core/dla/types').DocumentStructure | null = null;

      if (ctx.dlaAnalyze && extraction.pageCharData && extraction.pageCharData.length > 0) {
        const dlaStartTime = Date.now();
        try {
          const dlaBlocks = await ctx.dlaAnalyze(pdfPath, extraction.pageCount);
          if (dlaBlocks.length > 0) {
            const fusionResult = runFusionPipeline(dlaBlocks, extraction.pageCharData, fullText, logger);
            dlaStructure = fusionResult.structure;

            logger.info(`[process] Step 3b: DLA + fusion complete for ${paperId}`, {
              dlaBlockCount: dlaBlocks.length,
              typedBlockCount: fusionResult.typedBlocks.length,
              columnLayout: fusionResult.columnLayout,
              sectionCount: dlaStructure.sections.length,
              hasRefSection: dlaStructure.referenceSection != null,
              durationMs: Date.now() - dlaStartTime,
            });

            // Persist layout blocks + section boundaries to DB
            if (ctx.layoutPersist) {
              try {
                ctx.layoutPersist.clearLayoutAnalysis(paperId);

                const blockRows = fusionResult.typedBlocks.map((b) => ({
                  paperId: paperId as unknown,
                  blockType: b.blockType,
                  pageIndex: b.pageIndex,
                  bbox: { x: b.bbox.x, y: b.bbox.y, w: b.bbox.w, h: b.bbox.h },
                  confidence: b.confidence,
                  readingOrder: b.readingOrder,
                  columnIndex: b.columnIndex,
                  textContent: b.text,
                  charStart: b.charStart,
                  charEnd: b.charEnd,
                  modelVersion: 'doclayout-yolo-v1',
                }));
                ctx.layoutPersist.insertLayoutBlocks(paperId, blockRows);

                const boundaryRows = dlaStructure.sections.map((sec) => {
                  const allBlocks = [sec.titleBlock, ...sec.bodyBlocks];
                  const pages = allBlocks.map((b) => b.pageIndex);
                  const validStarts = allBlocks.filter((b) => b.charStart != null).map((b) => b.charStart!);
                  const validEnds = allBlocks.filter((b) => b.charEnd != null).map((b) => b.charEnd!);
                  return {
                    paperId: paperId as unknown,
                    label: sec.label,
                    title: sec.titleBlock.text?.trim() ?? '',
                    depth: sec.depth,
                    charStart: validStarts.length > 0 ? Math.min(...validStarts) : 0,
                    charEnd: validEnds.length > 0 ? Math.max(...validEnds) : 0,
                    pageStart: Math.min(...pages),
                    pageEnd: Math.max(...pages),
                  };
                });

                if (boundaryRows.length > 0) {
                  ctx.layoutPersist.insertSectionBoundaries(paperId, boundaryRows);
                }
              } catch (err) {
                logger.debug(`Paper ${paperId}: layout persistence failed`, { error: (err as Error).message });
              }
            }
          } else {
            logger.debug(`[process] Step 3b: DLA returned 0 blocks for ${paperId}, falling back to regex`);
          }
        } catch (err) {
          logger.warn(`[process] Step 3b: DLA analysis failed (non-fatal), falling back to regex`, {
            paperId, error: (err as Error).message, durationMs: Date.now() - dlaStartTime,
          });
        }
      }

      tracker?.advance('chunk', 'chunking');

      // ══ Step 4: Section structure recognition (§2.6.1) ══
      // Use DLA path when DocumentStructure is available, otherwise fall back to regex
      let sectionsResult;
      if (dlaStructure) {
        sectionsResult = processService.extractSectionsFromLayout(dlaStructure, fullText);
        logger.info(`[process] Step 4: Section recognition complete (DLA path) for ${paperId}`, {
          sectionCount: sectionsResult.sectionMap.size,
          sections: Array.from(sectionsResult.sectionMap.keys()),
        });
      } else {
        sectionsResult = processService.extractSections(fullText, extraction.styledLines);
        logger.info(`[process] Step 4: Section recognition complete (regex path) for ${paperId}`, {
          sectionCount: sectionsResult.sectionMap.size,
          sections: Array.from(sectionsResult.sectionMap.keys()),
        });
      }

      const sectionLabels = Array.from(sectionsResult.sectionMap.keys());
      const recognizedSectionCount = sectionLabels.filter((label) => label !== 'unknown').length;
      if (fullText.length >= 4000 && recognizedSectionCount === 0) {
        recordIssue('section_detection_degraded', 'warn', {
          sectionCount: sectionsResult.sectionMap.size,
          boundaryCount: sectionsResult.boundaries.length,
          boundarySample: sectionsResult.boundaries.slice(0, 8).map((boundary) => ({
            title: boundary.title,
            label: boundary.label,
            depth: boundary.depth ?? 1,
          })),
        });
      }

      // ══ Step 5: Structure-aware chunking (§2.6.2) ══
      let chunks;
      if (dlaStructure) {
        chunks = processService.chunkTextFromLayout(dlaStructure, fullText, {
          paperId: paperId as import('../../../core/types/common').PaperId,
        });
      } else {
        chunks = processService.chunkText(
          sectionsResult.sectionMap,
          sectionsResult.boundaries,
          extraction.pageTexts ?? [],
        );
      }
      chunkCount = chunks.length;

      const chunkTokenCounts = chunks.map((chunk) => (chunk as { tokenCount?: number }).tokenCount ?? 0);
      const maxChunkTokens = chunkTokenCounts.length > 0 ? Math.max(...chunkTokenCounts) : 0;
      const minChunkTokens = chunkTokenCounts.length > 0 ? Math.min(...chunkTokenCounts) : 0;

      logger.info(`[process] Step 5: Chunking complete for ${paperId}`, {
        chunkCount,
        avgChunkChars: chunkCount > 0 ? Math.round(fullText.length / chunkCount) : 0,
        minChunkTokens,
        maxChunkTokens,
        dlaPath: dlaStructure != null,
      });

      if (fullText.length >= 12000 && chunkCount < 3) {
        recordIssue('chunking_degraded', 'warn', {
          fullTextLength: fullText.length,
          chunkCount,
          minChunkTokens,
          maxChunkTokens,
          sectionLabels,
        });
      }

      tracker?.advance('index', 'indexing');

      // ══ Step 6-7: Embedding + vector index (§2.7) ══
      const ragService = resolveCurrentRagService(ctx);
      if (!ragService) {
        recordIssue('rag_service_unavailable', 'warn', {
          chunkCount,
        });
        logger.warn(`[process] Step 6-7: ragService unavailable for ${paperId}`);
      } else if (chunks.length === 0) {
        recordIssue('no_chunks_produced', 'warn', {
          fullTextLength: fullText.length,
          sectionLabels,
        });
        logger.warn(`[process] Step 6-7: No chunks produced for ${paperId}, skipping indexing`);
      } else {
        const indexStartTime = Date.now();
        try {
          await ragService.embedAndIndexChunks(chunks);
          vectorIndexed = true;
          logger.info(`[process] Step 6-7: Vector indexing complete for ${paperId}`, {
            chunkCount, durationMs: Date.now() - indexStartTime,
          });
        } catch (err) {
          logger.warn(`[process] Step 6-7: Vector indexing failed for ${paperId}`, {
            error: (err as Error).message,
            chunkCount,
            durationMs: Date.now() - indexStartTime,
          });
          recordIssue('vector_indexing_failed');
        }
      }

      // ══ Step 8: Reference extraction + persistence (§2.8) ══
      try {
        // Use DLA reference section when available
        const references = dlaStructure
          ? processService.extractReferencesFromLayout(dlaStructure)
          : processService.extractReferences(fullText);
        refCount = references.length;
        logger.info(`[process] Step 8: Reference extraction complete for ${paperId}`, {
          refCount, dlaPath: dlaStructure != null,
        });
        if (references.length === 0 && fullText.length >= 6000) {
          if (/(?:references|bibliography|参考文献)/i.test(fullText)) {
            recordIssue('no_references_extracted', 'warn', {
              fullTextLength: fullText.length,
              dlaPath: dlaStructure != null,
            });
          }
          logger.warn(`[process] Step 8: No references extracted for ${paperId}`, {
            fullTextLength: fullText.length,
            hasReferenceHeadingHint: /(?:references|bibliography|参考文献)/i.test(fullText),
            dlaPath: dlaStructure != null,
          });
        }
        if (references.length > 0 && ctx.hydratePersist) {
          try {
            ctx.hydratePersist.upsertReferences(paperId, references);
          } catch (err) {
            logger.debug(`Paper ${paperId}: reference persistence failed`, { error: (err as Error).message });
          }
        }
      } catch (err) {
        recordIssue('reference_extraction_failed');
        logger.warn(`[process] Step 8: Reference extraction failed for ${paperId}`, { error: (err as Error).message });
      }
    }
  } else {
    logger.warn(`Paper ${paperId}: processService unavailable, skipping text extraction (steps 3-8)`);
    recordIssue('process_service_unavailable');
  }

  // ══ Step 9: Bibliography enrichment (§2.9) ══
  if (ctx.bibliographyService) {
    try {
      const enrichedPaper = { ...paper, ...hydratePatch };
      await ctx.bibliographyService.enrichBibliography(enrichedPaper);
      logger.info(`[process] Step 9: Bibliography enrichment complete for ${paperId}`);
    } catch (err) {
      logger.debug(`Paper ${paperId}: bibliography enrichment failed`, { error: (err as Error).message });
    }
  }

  const persistedTextPath = textTooShortOrMissing(textPath, processIssues) ? null : textPath;
  const failureReason = selectPrimaryProcessFailureReason(
    persistedTextPath ? processIssues : ['text_extraction_failed', ...processIssues],
  );

  logger.info(`[process] processExtractAndHydrate complete for ${paperId}`, {
    vectorIndexed,
    failureReason,
    processIssues,
    hydrateFields: Object.keys(hydratePatch).length,
    persistedTextPath,
    textChars: textPath ? (await fs.promises.stat(textPath).catch(() => null))?.size ?? 0 : 0,
    chunkCount,
    refCount,
    durationMs: Date.now() - pipelineStartTime,
  });

  return { textPath: persistedTextPath, vectorIndexed, failureReason, hydratePatch };
}

function textTooShortOrMissing(textPath: string | null, processIssues: string[]): boolean {
  return !textPath || processIssues.includes('extracted_text_too_short');
}
