/**
 * Acquire workflow — fulltext acquisition → extraction → chunking → vector indexing.
 *
 * 11-step pipeline:
 * 1.  Five-level cascade fulltext download (§2.3)
 * 2.  PDF validation (§2.4)
 * 3.  Text extraction with OCR fallback (§2.5)
 * 4.  Section structure recognition (§2.6.1)
 * 5.  Structure-aware chunking (§2.6.2)
 * 6.  Embedding generation (§2.7)
 * 7.  Vector index — transactional atomic (§2.7)
 * 8.  Reference extraction (§2.8)
 * 9.  Bibliography enrichment (§2.9)
 * 10. VLM figure parsing — optional (§2.10)
 * 11. Status update
 *
 * Idempotency: skips papers where fulltext_status != 'pending'.
 * Checkpoint: failure_count tracks retries; >= 3 → permanently_failed (§5.1.2).
 * Circuit breaker: 10 consecutive same-category failures → abort (§7.3).
 *
 * See spec: §2, §5
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { AcquireService } from '../../../core/acquire';
import type { ProcessService } from '../../../core/process';
import type { Logger } from '../../../core/infra/logger';
import { CircuitBreaker, withRetry, classifyError } from '../error-classifier';
import { createConcurrencyGuard } from '../concurrency-guard';

// ─── Services interface ───

export interface AcquireServices {
  dbProxy: {
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getPaper: (id: string) => Promise<Record<string, unknown> | null>;
    updatePaper: (id: unknown, fields: unknown) => Promise<void>;
    insertChunksBatch?: (chunks: unknown[]) => Promise<number[]>;
  };
  acquireService: AcquireService;
  processService: ProcessService;
  ragService: {
    indexChunks: (paperId: string, chunks: unknown[], embeddings?: unknown[]) => Promise<void>;
  } | null;
  bibliographyService: {
    enrichBibliography: (paper: unknown) => Promise<unknown>;
  } | null;
  logger: Logger;
  workspacePath: string;
}

// ─── Source statistics ───

export interface AcquisitionStats {
  bySource: Record<string, number>;
  total: number;
  failed: number;
}

// ─── Workflow ───

export function createAcquireWorkflow(services: AcquireServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, acquireService, processService, logger, workspacePath } = services;
    const breaker = new CircuitBreaker(10);
    const guard = createConcurrencyGuard('acquire', options.concurrency);

    // Query papers needing acquisition (§5.1.1)
    let paperIds = options.paperIds;
    if (!paperIds || paperIds.length === 0) {
      const result = await dbProxy.queryPapers({
        fulltextStatus: ['pending'],
        relevance: ['high', 'medium'],
        limit: 1000,
      });
      paperIds = result.items
        .filter((p) => {
          const failCount = (p['failureCount'] ?? p['failure_count'] ?? 0) as number;
          return failCount < 3; // Skip permanently_failed (§5.1.2)
        })
        .map((p) => p['id'] as string);
    }

    runner.setTotal(paperIds.length);
    if (paperIds.length === 0) return;

    const concurrency = options.concurrency ?? 5;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paperIds!.length) {
        if (runner.signal.aborted) break;
        const paperId = paperIds![nextIndex++]!;

        await guard.runWithSlot(async ({ writeExclusive }) => {
          runner.reportProgress({ currentItem: paperId, currentStage: 'acquiring' });

          try {
            await acquireSinglePaper(paperId, {
              dbProxy,
              acquireService,
              processService,
              ragService: services.ragService,
              bibliographyService: services.bibliographyService,
              logger,
              workspacePath,
              writeExclusive,
            });
            runner.reportComplete(paperId);
            breaker.recordSuccess();
          } catch (error) {
            const classified = classifyError(error);
            runner.reportFailed(paperId, 'acquire', error as Error);
            breaker.recordFailure(error);

            // Update failure count (§5.1.2)
            try {
              await writeExclusive(async () => {
                const paper = await dbProxy.getPaper(paperId);
                const currentCount = (paper?.['failureCount'] ?? paper?.['failure_count'] ?? 0) as number;
                const newCount = currentCount + 1;
                await dbProxy.updatePaper(paperId, {
                  fulltextStatus: newCount >= 3 ? 'failed' : 'pending',
                  failureReason: classified.message.slice(0, 200),
                  failureCount: newCount,
                });
              });
            } catch { /* ignore DB error during error handling */ }
          }
        });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  };
}

// ─── Single paper acquisition ───

async function acquireSinglePaper(
  paperId: string,
  ctx: {
    dbProxy: AcquireServices['dbProxy'];
    acquireService: AcquireService;
    processService: ProcessService;
    ragService: AcquireServices['ragService'];
    bibliographyService: AcquireServices['bibliographyService'];
    logger: Logger;
    workspacePath: string;
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
): Promise<void> {
  const { dbProxy, acquireService, processService, logger, workspacePath, writeExclusive } = ctx;

  // ── Zone 1: Read (no lock) ──
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);

  const fulltextStatus = paper['fulltextStatus'] ?? paper['fulltext_status'];
  if (fulltextStatus === 'acquired') {
    return; // Already processed — idempotent skip
  }

  const doi = (paper['doi'] as string) ?? null;
  const arxivId = (paper['arxivId'] as string ?? paper['arxiv_id'] as string) ?? null;
  const pmcid = (paper['pmcid'] as string) ?? null;

  // ══ Step 1: Five-level cascade fulltext download (§2.3) ══
  const pdfDir = path.join(workspacePath, 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `${paperId}.pdf`);

  const acquireResult = await withRetry(() =>
    acquireService.acquireFulltext({
      doi,
      arxivId,
      pmcid,
      url: null,
      savePath: pdfPath,
    }),
  );

  if (acquireResult.status !== 'success') {
    const resultAny = acquireResult as unknown as Record<string, unknown>;
    const attempts = resultAny['attempts'] as Array<{ source: string; failureReason: string | null }> | undefined;
    const reason = attempts
      ? attempts.map((a) => `${a.source}:${a.failureReason}`).join('; ')
      : 'all_sources_failed';

    await writeExclusive(async () => {
      await dbProxy.updatePaper(paperId, {
        fulltextStatus: 'failed',
        failureReason: reason.slice(0, 200),
      });
    });
    throw new Error(`Acquire failed: ${reason}`);
  }

  // Steps 2 (PDF validation) is handled inside AcquireService

  // ══ Step 3: Text extraction (§2.5) ══
  const textDir = path.join(workspacePath, 'texts');
  fs.mkdirSync(textDir, { recursive: true });
  const textPath = path.join(textDir, `${paperId}.txt`);

  const extraction = await processService.extractText(pdfPath);
  const fullText = extraction.fullText ?? '';

  if (fullText.length < 50) {
    logger.warn(`Paper ${paperId}: extracted text too short (${fullText.length} chars)`);
  }

  // Write text file atomically (§5.2.3)
  const tmpTextPath = textPath + '.tmp';
  fs.writeFileSync(tmpTextPath, fullText, 'utf-8');
  fs.renameSync(tmpTextPath, textPath);

  // ══ Step 4: Section structure recognition (§2.6.1) ══
  const sectionsResult = processService.extractSections(fullText);

  // ══ Step 5: Structure-aware chunking (§2.6.2) ══
  const chunks = processService.chunkText(
    sectionsResult.sectionMap,
    sectionsResult.boundaries,
    extraction.pageTexts ?? [],
  );

  // ══ Step 6-7: Embedding + vector index (§2.7) ══
  if (ctx.ragService && chunks.length > 0) {
    try {
      // TODO: RagService.indexChunks handles embedding generation internally
      await ctx.ragService.indexChunks(paperId, chunks);
    } catch (err) {
      logger.warn(`Paper ${paperId}: vector indexing failed`, { error: (err as Error).message });
      // Non-fatal — text is still available for keyword search
    }
  }

  // ══ Step 8: Reference extraction (§2.8) ══
  try {
    const references = processService.extractReferences(fullText);
    if (references.length > 0) {
      logger.debug(`Paper ${paperId}: extracted ${references.length} references`);
      // References are used for citation graph enrichment in future runs
    }
  } catch {
    // Non-fatal
  }

  // ══ Step 9: Bibliography enrichment (§2.9) ══
  if (ctx.bibliographyService) {
    try {
      await ctx.bibliographyService.enrichBibliography(paper);
    } catch (err) {
      logger.debug(`Paper ${paperId}: bibliography enrichment failed`, { error: (err as Error).message });
      // Non-fatal
    }
  }

  // ══ Step 10: VLM figure parsing — optional ══
  // TODO: VLM figure parsing (parseFiguresWithVlm) requires VLM model configuration

  // ══ Step 11: Status update (Zone 3: Write) ══
  await writeExclusive(async () => {
    await dbProxy.updatePaper(paperId, {
      fulltextStatus: 'acquired',
      fulltextPath: pdfPath,
      textPath,
      failureReason: null,
      failureCount: 0, // Reset on success (§5.1.2)
      fulltextSource: acquireResult.source,
    });
  });
}
