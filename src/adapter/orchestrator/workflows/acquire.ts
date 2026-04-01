/**
 * Acquire workflow — fulltext acquisition only.
 *
 * Pipeline steps:
 * 0.  Fuzzy identifier resolution (Feature 3) — if no DOI/arXiv/PMCID
 * 1.  Five-level cascade fulltext download (§2.3)
 * 1b. Record source failures to FailureMemory (Feature 2)
 * 2.  PDF validation (§2.4)
 * 3.  Status update (fulltextPath + fulltextStatus)
 *
 * Post-processing (text extraction, chunking, embedding) is handled by
 * the separate "process" workflow — see process.ts.
 *
 * Idempotency: skips papers where fulltext_status = 'available'.
 * Checkpoint: failure_count tracks retries; >= 3 → permanently_failed (§5.1.2).
 * Circuit breaker: 10 consecutive same-category failures → abort (§7.3).
 *
 * See spec: §2, §5
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext, WorkflowSubstep } from '../workflow-runner';
import type { AcquireService } from '../../../core/acquire';
import type { Logger } from '../../../core/infra/logger';
import type { IdentifierResolver } from '../../../core/acquire/identifier-resolver';
import type { ContentSanityChecker } from '../../../core/acquire/content-sanity-checker';
import type { FailureMemory, AcquireFailureType } from '../../../core/acquire/failure-memory';
import type { AcquireConfig } from '../../../core/types/config';
import { extractDoiPrefix } from '../../../core/acquire/failure-memory';
import { CircuitBreaker, CircuitBreakerTripped, classifyError } from '../error-classifier';
import { PaperNotFoundError } from '../../../core/types/errors';
import { createConcurrencyGuard, type ConcurrencyGuard } from '../concurrency-guard';
import { paperField } from '../utils';

// ─── Services interface ───

export interface AcquireServices {
  dbProxy: {
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getPaper: (id: string) => Promise<Record<string, unknown> | null>;
    updatePaper: (id: unknown, fields: unknown) => Promise<void>;
  };
  acquireService: AcquireService;
  identifierResolver: IdentifierResolver | null;
  sanityChecker: ContentSanityChecker | null;
  failureMemory: FailureMemory | null;
  acquireConfig: AcquireConfig;
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
    const { dbProxy, acquireService, logger, workspacePath } = services;
    const breaker = new CircuitBreaker(10);
    const guard = createConcurrencyGuard('acquire', options.concurrency);

    const workflowStartTime = Date.now();
    logger.info('[AcquireWorkflow] Workflow function entered', { paperIds: options.paperIds, concurrency: options.concurrency });

    const logWorkflowSummary = () => {
      const p = runner.progress;
      logger.info('[AcquireWorkflow] Workflow complete', {
        succeeded: p.completedItems,
        failed: p.failedItems,
        skipped: p.skippedItems,
        total: p.totalItems,
        errors: p.errors.length,
        qualityWarnings: p.qualityWarnings.length,
        durationMs: Date.now() - workflowStartTime,
      });
    };

    // If no paperIds provided, query DB for pending papers (§5.1.1)
    if (!options.paperIds || options.paperIds.length === 0) {
      logger.info('[AcquireWorkflow] No paperIds provided, querying DB for pending papers');
      const result = await dbProxy.queryPapers({
        fulltextStatus: ['pending'],
        relevance: ['high', 'medium'],
        limit: 1000,
      });
      const dbPaperIds = result.items
        .filter((p) => {
          return paperField(p, 'failureCount', 0) < 3; // Skip permanently_failed (§5.1.2)
        })
        .map((p) => p['id'] as string);
      logger.info('[AcquireWorkflow] DB query returned papers', { count: dbPaperIds.length });

      if (dbPaperIds.length === 0) {
        logger.info('[AcquireWorkflow] No papers to acquire, returning');
        return;
      }

      // If runner supports live queue (enqueue-merge), feed DB results into it
      // Otherwise fall through to static iteration below
      if (!runner.takeFromQueue) {
        // No queue support — use static list (fallback for non-acquire runner)
        options = { ...options, paperIds: dbPaperIds };
      }
    }

    runner.setTotal(options.paperIds?.length ?? 0);
    const concurrency = options.concurrency ?? 5;

    // ── Queue-based worker (supports live enqueue from WorkflowRunner) ──
    if (runner.takeFromQueue) {
      logger.info('[AcquireWorkflow] Using queue-based workers', { concurrency });

      const worker = async () => {
        while (!runner.signal.aborted) {
          const paperId = await runner.takeFromQueue!();
          if (paperId === null) break; // Queue drained
          await processOneItem(paperId, services, guard, breaker, runner, logger);
        }
      };

      await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
      logWorkflowSummary();
      return;
    }

    // ── Fallback: static paperIds iteration (non-queue path) ──
    const paperIds = options.paperIds ?? [];
    runner.setTotal(paperIds.length);
    logger.info('[AcquireWorkflow] Using static worker loop', { count: paperIds.length, concurrency });

    if (paperIds.length === 0) {
      logger.info('[AcquireWorkflow] No papers to acquire, returning');
      return;
    }

    // Atomic index counter — each worker increments to claim the next item.
    // Safer than Array.shift() which mutates the array across concurrent workers.
    let nextIndex = 0;
    const worker = async () => {
      while (!runner.signal.aborted) {
        const idx = nextIndex++;
        if (idx >= paperIds.length) break;
        await processOneItem(paperIds[idx]!, services, guard, breaker, runner, logger);
      }
    };

    await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
    logWorkflowSummary();
  };
}

// ─── Shared per-item processing (deduplicates queue / static worker logic) ───

async function processOneItem(
  paperId: string,
  services: AcquireServices,
  guard: ConcurrencyGuard,
  breaker: CircuitBreaker,
  runner: WorkflowRunnerContext,
  logger: Logger,
): Promise<void> {
  if (breaker.failures >= 10) {
    runner.reportSkipped(paperId);
    return;
  }

  await guard.runWithSlot(async ({ writeExclusive }) => {
    runner.reportProgress({ currentItem: paperId, currentStage: 'acquiring' });

    try {
      logger.info(`[AcquireWorkflow] Starting acquireSinglePaper`, { paperId });
      await acquireSinglePaper(paperId, { ...services, writeExclusive }, runner);
      logger.info(`[AcquireWorkflow] acquireSinglePaper SUCCESS`, { paperId });
      runner.reportComplete(paperId);
      breaker.recordSuccess();
    } catch (error) {
      const classified = classifyError(error);
      logger.error(`[AcquireWorkflow] acquireSinglePaper FAILED: ${(error as Error).message}`, undefined, { paperId, classifiedCategory: classified.category, classifiedMessage: classified.message });
      runner.reportFailed(paperId, 'acquire', error as Error);

      // Record failure — catch CircuitBreakerTripped to prevent orphaned workers
      try {
        breaker.recordFailure(error);
      } catch (cbErr) {
        if (cbErr instanceof CircuitBreakerTripped) {
          logger.warn(`[AcquireWorkflow] Circuit breaker tripped after ${paperId}`, { category: cbErr.category });
        } else {
          throw cbErr;
        }
      }

      // Update failure count (§5.1.2)
      try {
        await writeExclusive(async () => {
          const paper = await services.dbProxy.getPaper(paperId);
          const currentCount = paperField(paper, 'failureCount', 0);
          const newCount = currentCount + 1;
          await services.dbProxy.updatePaper(paperId, {
            fulltextStatus: newCount >= 3 ? 'failed' : 'pending',
            failureReason: classified.message.slice(0, 200),
            failureCount: newCount,
          });
        });
      } catch (dbErr) {
        logger.debug(`Paper ${paperId}: failure count update failed`, { error: (dbErr as Error).message });
      }
    }
  });
}

// ─── Single paper acquisition ───

async function acquireSinglePaper(
  paperId: string,
  ctx: AcquireServices & {
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
  runner?: WorkflowRunnerContext,
): Promise<void> {
  const {
    dbProxy, acquireService, logger, workspacePath, writeExclusive,
    identifierResolver, failureMemory, acquireConfig,
  } = ctx;

  const paperStartTime = Date.now();
  logger.info(`[acquire] Starting acquisition for paper ${paperId}`);

  // ── Zone 1: Read (no lock) ──
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) {
    logger.error(`[acquire] Paper not found: ${paperId}`);
    throw new PaperNotFoundError({ message: `Paper not found: ${paperId}` });
  }

  const fulltextStatus = paperField<string | null>(paper, 'fulltextStatus', null);
  if (fulltextStatus === 'available') {
    logger.info(`[acquire] Paper ${paperId} already available, skipping`);
    return; // Already processed — idempotent skip
  }

  let doi = paperField<string | null>(paper, 'doi', null);
  let arxivId = paperField<string | null>(paper, 'arxivId', null);
  let pmcid = paperField<string | null>(paper, 'pmcid', null);
  const title = paperField(paper, 'title', '');
  const authors = paperField<string[]>(paper, 'authors', []);
  const year = paperField<number | null>(paper, 'year', null);
  const publisher = paperField<string | null>(paper, 'publisher', null) ?? paperField<string | null>(paper, 'venue', null);

  logger.info(`[acquire] Paper ${paperId} identifiers`, { doi, arxivId, pmcid, title: title.slice(0, 60), fulltextStatus });

  // ══ Manual PDF shortcut: paper already has a valid fulltextPath (e.g. user linked a local PDF) ══
  const existingFulltextPath = paperField<string | null>(paper, 'fulltextPath', null);
  if (existingFulltextPath) {
    const resolvedPath = path.isAbsolute(existingFulltextPath)
      ? existingFulltextPath
      : path.join(workspacePath, existingFulltextPath);

    if (fs.existsSync(resolvedPath)) {
      logger.info(`[acquire] Paper ${paperId} has local PDF, marking available`, { path: resolvedPath });

      await writeExclusive(async () => {
        await dbProxy.updatePaper(paperId, {
          fulltextStatus: 'available',
          fulltextPath: resolvedPath,
          failureCount: 0,
          fulltextSource: 'manual',
        });
      });
      logger.info(`[acquire] Paper ${paperId} manual PDF ready ✓`, {
        resolvedPath, durationMs: Date.now() - paperStartTime,
      });
      return;
    }
  }

  // ══ Step 0: Fuzzy identifier resolution (Feature 3) ══
  if (!doi && !arxivId && !pmcid && identifierResolver && acquireConfig.enableFuzzyResolve && title.length > 10) {
    logger.info(`[acquire] Step 0: Attempting fuzzy identifier resolution for "${title.slice(0, 60)}"`);
    try {
      const resolved = await identifierResolver.resolve(
        { title, authors, year },
        acquireConfig.fuzzyResolveConfidenceThreshold,
      );

      if (resolved.doi || resolved.arxivId || resolved.pmcid) {
        doi = resolved.doi ?? doi;
        arxivId = resolved.arxivId ?? arxivId;
        pmcid = resolved.pmcid ?? pmcid;

        logger.info(`[acquire] Step 0: Identifiers resolved!`, {
          doi, arxivId, pmcid,
          confidence: resolved.confidence,
          resolvedVia: resolved.resolvedVia,
          candidatesFound: resolved.candidatesFound,
        });

        // 持久化解析结果到数据库
        await writeExclusive(async () => {
          const updateFields: Record<string, unknown> = { identifiersResolvedVia: resolved.resolvedVia };
          if (resolved.doi) updateFields['doi'] = resolved.doi;
          if (resolved.arxivId) updateFields['arxivId'] = resolved.arxivId;
          if (resolved.pmcid) updateFields['pmcid'] = resolved.pmcid;
          await dbProxy.updatePaper(paperId, updateFields);
        });
      } else {
        logger.info(`[acquire] Step 0: No identifiers found (confidence=${resolved.confidence.toFixed(2)}, candidates=${resolved.candidatesFound})`);
      }
    } catch (err) {
      logger.warn(`[acquire] Step 0: Identifier resolution failed`, { error: (err as Error).message });
      // Non-fatal — continue with whatever identifiers we have
    }
  }

  // ══ Step 1: Five-level cascade fulltext download (§2.3) ══
  const pdfDir = path.join(workspacePath, 'pdfs');
  await fs.promises.mkdir(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `${paperId}.pdf`);

  // Feature 2: FailureMemory-driven source ordering
  let sourceOrdering: string[] | undefined;
  if (failureMemory && acquireConfig.enableFailureMemory) {
    const defaultSources = [
      ...acquireConfig.enabledSources,
      ...(acquireConfig.institutionalProxyUrl ? ['institutional'] : []),
      ...(acquireConfig.enableScihub ? ['scihub'] : []),
    ];
    sourceOrdering = failureMemory.getSourceOrdering(defaultSources, doi, publisher);
  }

  // ── Substep tracking for cascade download ──
  const substeps: WorkflowSubstep[] = [];

  const onSourceAttempt = runner
    ? (source: string, phase: 'start' | 'end', result?: { status: string; failureReason?: string | null }) => {
        if (phase === 'start') {
          // Mark this source as running, others remain as-is
          const existing = substeps.find((s) => s.name === source);
          if (existing) {
            existing.status = 'running';
          } else {
            substeps.push({ name: source, status: 'running' });
          }
        } else {
          // phase === 'end'
          const existing = substeps.find((s) => s.name === source);
          const finalStatus = result?.status === 'success' ? 'success' as const
            : result?.status === 'skipped' ? 'skipped' as const
            : 'failed' as const;
          const detail = result?.failureReason ?? undefined;
          if (existing) {
            existing.status = finalStatus;
            if (detail !== undefined) existing.detail = detail;
          } else {
            const step: WorkflowSubstep = { name: source, status: finalStatus };
            if (detail !== undefined) step.detail = detail;
            substeps.push(step);
          }
        }
        runner.reportProgress({ currentStage: 'acquiring', substeps: [...substeps] });
      }
    : undefined;

  logger.info(`[acquire] Step 1: Starting cascade download for ${paperId}`, { pdfPath, doi, arxivId, pmcid, sourceOrdering });
  // NOTE: Do NOT wrap with withRetry — acquireFulltext already has per-source retry
  // internally via attempt-utils.withRetry. Double-wrapping would re-run the entire
  // 4-layer cascade on transient failures, amplifying latency by 3x.
  const acquireResult = await acquireService.acquireFulltext({
    doi,
    arxivId,
    pmcid,
    url: null,
    savePath: pdfPath,
    sourceOrdering,
    onSourceAttempt,
    paperTitle: title,
    paperAuthors: authors,
    paperYear: year,
  });

  // Log every source attempt + record failures to FailureMemory (Feature 2)
  const doiPrefix = extractDoiPrefix(doi);
  for (const attempt of acquireResult.attempts) {
    logger.info(`[acquire] Source attempt: ${attempt.source}`, {
      paperId, status: attempt.status, durationMs: attempt.durationMs,
      failureReason: attempt.failureReason, failureCategory: attempt.failureCategory,
      httpStatus: attempt.httpStatus,
    });

    // 记录到 FailureMemory（成功 + 失败都记录，使 failureRate 准确）
    if (failureMemory && acquireConfig.enableFailureMemory) {
      if (attempt.status === 'success') {
        failureMemory.recordSuccess(attempt.source, doi, publisher);
      } else if (attempt.status === 'failed' || attempt.status === 'timeout') {
        const categoryToFailureType: Record<string, AcquireFailureType> = {
          timeout: 'timeout',
          rate_limited: 'timeout',
          http_4xx: 'http_error',
          http_5xx: 'http_error',
          dns_error: 'http_error',
          connection_reset: 'http_error',
          ssl_error: 'http_error',
          invalid_pdf: 'validation_failed',
          no_pdf_url: 'no_pdf_url',
          parse_error: 'validation_failed',
          unknown: 'unknown',
        };
        const failureType: AcquireFailureType = attempt.failureCategory
          ? (categoryToFailureType[attempt.failureCategory] ?? 'unknown')
          : 'unknown';

        failureMemory.recordFailure({
          paperId,
          source: attempt.source,
          failureType,
          publisher,
          doiPrefix,
          httpStatus: attempt.httpStatus ?? null,
          detail: attempt.failureReason,
        });
      }
    }
  }

  if (acquireResult.status === 'suspicious') {
    // SanityCheck flagged content mismatch — PDF is kept for user review.
    // Don't increment failureCount (avoids false-positive → permanent failure).
    logger.warn(`[acquire] SanityCheck suspicious for ${paperId} — PDF kept for review`, {
      source: acquireResult.source, pdfPath: acquireResult.pdfPath,
    });

    await writeExclusive(async () => {
      await dbProxy.updatePaper(paperId, {
        fulltextStatus: 'suspicious',
        fulltextPath: pdfPath,
        fulltextSource: acquireResult.source,
        failureReason: 'Content sanity check failed — PDF may not match expected paper',
      });
    });
    // Don't throw — paper has a PDF, just needs manual verification
    return;
  }

  if (acquireResult.status !== 'success') {
    const reason = acquireResult.attempts
      .map((a) => `${a.source}:${a.failureReason}`)
      .join('; ') || 'all_sources_failed';

    logger.error(`[acquire] All sources failed for ${paperId}: ${reason}`);

    // NOTE: Do NOT update DB here — processOneItem's catch block handles
    // failure count increment and status transition (pending → failed at ≥3).
    // Writing 'failed' here unconditionally was a bug: it bypassed the 3-strike
    // logic and the outer catch would overwrite it anyway.
    throw new Error(`Acquire failed: ${reason}`);
  }

  logger.info(`[acquire] Step 1 complete: PDF acquired for ${paperId}`, {
    source: acquireResult.source,
    fileSize: acquireResult.fileSize,
  });

  // Steps 2 (PDF validation) is handled inside AcquireService

  // ══ Final: Status update — mark PDF as available ══
  logger.info(`[acquire] Writing final status for ${paperId}`);
  await writeExclusive(async () => {
    await dbProxy.updatePaper(paperId, {
      fulltextStatus: 'available',
      fulltextPath: pdfPath,
      failureCount: 0,
      fulltextSource: acquireResult.source,
    });
  });
  logger.info(`[acquire] Paper ${paperId} acquisition complete ✓`, {
    source: acquireResult.source,
    pdfPath,
    durationMs: Date.now() - paperStartTime,
  });
}
