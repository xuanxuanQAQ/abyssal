/**
 * Acquire workflow — fulltext acquisition → extraction → chunking → vector indexing.
 *
 * 15-step pipeline (with LLM enhancements + metadata hydration):
 * 0.  Fuzzy identifier resolution (Feature 3) — if no DOI/arXiv/PMCID
 * 1.  Five-level cascade fulltext download (§2.3)
 * 1b. Record source failures to FailureMemory (Feature 2)
 * 2.  PDF validation (§2.4)
 * 3.  Text extraction with OCR fallback (§2.5)
 * 3b. LLM content sanity check (Feature 1) — detect paywalls, wrong paper, etc.
 * 3c. Metadata hydration — fill missing fields from PDF dict/heuristic/LLM/API/CrossRef
 * 4.  Section structure recognition (§2.6.1)
 * 5.  Structure-aware chunking (§2.6.2)
 * 6.  Embedding generation (§2.7)
 * 7.  Vector index — transactional atomic (§2.7)
 * 8.  Reference extraction + persistence (§2.8)
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

import type { WorkflowOptions, WorkflowRunnerContext, WorkflowSubstep } from '../workflow-runner';
import type { AcquireService } from '../../../core/acquire';
import type { ProcessService } from '../../../core/process';
import type { Logger } from '../../../core/infra/logger';
import type { IdentifierResolver } from '../../../core/acquire/identifier-resolver';
import type { ContentSanityChecker } from '../../../core/acquire/content-sanity-checker';
import type { FailureMemory, AcquireFailureType } from '../../../core/acquire/failure-memory';
import type { AcquireConfig } from '../../../core/types/config';
import type { PaperMetadata } from '../../../core/types/paper';
import type { PdfEmbeddedMetadata, FirstPageMetadata, ExtractedReference } from '../../../core/types';
import type { HydrateConfig, MetadataLookupService, EnrichService } from '../../../core/hydrate';
import { hydratePaperMetadata } from '../../../core/hydrate';
import type { LlmCallFn } from '../../../core/hydrate';
import { extractDoiPrefix } from '../../../core/acquire/failure-memory';
import { CircuitBreaker, withRetry, classifyError } from '../error-classifier';
import { PaperNotFoundError } from '../../../core/types/errors';
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
  processService: ProcessService | null;
  ragService: {
    indexChunks: (paperId: string, chunks: unknown[], embeddings?: unknown[]) => Promise<void>;
  } | null;
  bibliographyService: {
    enrichBibliography: (paper: unknown) => Promise<unknown>;
  } | null;
  // LLM-enhanced services (all optional)
  identifierResolver: IdentifierResolver | null;
  sanityChecker: ContentSanityChecker | null;
  failureMemory: FailureMemory | null;
  acquireConfig: AcquireConfig;
  logger: Logger;
  workspacePath: string;
  // Hydrate pipeline services
  hydrateConfig: HydrateConfig;
  llmCallFn: LlmCallFn | null;
  lookupService: MetadataLookupService | null;
  enrichService: EnrichService | null;
  /** DAO callbacks for persisting hydrate results (injected to avoid core→db circular dep) */
  hydratePersist: {
    upsertReferences: (paperId: string, refs: ExtractedReference[]) => void;
    insertHydrateLogs: (paperId: string, logs: Array<{ field: string; value: unknown; source: string }>) => void;
  } | null;
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

    logger.info('[AcquireWorkflow] Workflow function entered', { paperIds: options.paperIds, concurrency: options.concurrency });

    // Query papers needing acquisition (§5.1.1)
    let paperIds = options.paperIds;
    if (!paperIds || paperIds.length === 0) {
      logger.info('[AcquireWorkflow] No paperIds provided, querying DB for pending papers');
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
      logger.info('[AcquireWorkflow] DB query returned papers', { count: paperIds.length });
    }

    runner.setTotal(paperIds.length);
    logger.info('[AcquireWorkflow] Total papers to acquire', { count: paperIds.length });
    if (paperIds.length === 0) {
      logger.info('[AcquireWorkflow] No papers to acquire, returning');
      return;
    }

    const concurrency = options.concurrency ?? 5;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paperIds!.length) {
        if (runner.signal.aborted) break;
        const paperId = paperIds![nextIndex++]!;

        await guard.runWithSlot(async ({ writeExclusive }) => {
          runner.reportProgress({ currentItem: paperId, currentStage: 'acquiring' });

          try {
            logger.info(`[AcquireWorkflow] Starting acquireSinglePaper`, { paperId });
            await acquireSinglePaper(paperId, {
              ...services,
              writeExclusive,
            }, runner);
            logger.info(`[AcquireWorkflow] acquireSinglePaper SUCCESS`, { paperId });
            runner.reportComplete(paperId);
            breaker.recordSuccess();
          } catch (error) {
            const classified = classifyError(error);
            logger.error(`[AcquireWorkflow] acquireSinglePaper FAILED: ${(error as Error).message}`, undefined, { paperId, classifiedCategory: classified.category, classifiedMessage: classified.message });
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
  ctx: AcquireServices & {
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
  runner?: WorkflowRunnerContext,
): Promise<void> {
  const {
    dbProxy, acquireService, processService, logger, workspacePath, writeExclusive,
    identifierResolver, sanityChecker, failureMemory, acquireConfig,
  } = ctx;

  logger.info(`[acquire] Starting acquisition for paper ${paperId}`);

  // ── Zone 1: Read (no lock) ──
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) {
    logger.error(`[acquire] Paper not found: ${paperId}`);
    throw new PaperNotFoundError({ message: `Paper not found: ${paperId}` });
  }

  const fulltextStatus = paper['fulltextStatus'] ?? paper['fulltext_status'];
  if (fulltextStatus === 'available') {
    logger.info(`[acquire] Paper ${paperId} already available, skipping`);
    return; // Already processed — idempotent skip
  }

  let doi = (paper['doi'] as string) ?? null;
  let arxivId = (paper['arxivId'] as string ?? paper['arxiv_id'] as string) ?? null;
  let pmcid = (paper['pmcid'] as string) ?? null;
  const title = (paper['title'] as string) ?? '';
  const authors = (paper['authors'] as string[]) ?? [];
  const year = (paper['year'] as number) ?? null;
  const publisher = (paper['publisher'] as string ?? paper['venue'] as string) ?? null;

  logger.info(`[acquire] Paper ${paperId} identifiers`, { doi, arxivId, pmcid, title: title.slice(0, 60), fulltextStatus });

  // ══ Manual PDF shortcut: paper already has a valid fulltextPath (e.g. user linked a local PDF) ══
  const existingFulltextPath = (paper['fulltextPath'] ?? paper['fulltext_path']) as string | null;
  if (existingFulltextPath) {
    const resolvedPath = path.isAbsolute(existingFulltextPath)
      ? existingFulltextPath
      : path.join(workspacePath, existingFulltextPath);

    if (fs.existsSync(resolvedPath)) {
      logger.info(`[acquire] Paper ${paperId} has local PDF, skipping download cascade`, { path: resolvedPath });

      const result = await processExtractAndHydrate(paperId, resolvedPath, paper, ctx);

      await writeExclusive(async () => {
        await dbProxy.updatePaper(paperId, {
          ...result.hydratePatch,
          fulltextStatus: result.vectorIndexed ? 'available' : 'acquired',
          fulltextPath: resolvedPath,
          textPath: result.textPath,
          failureReason: result.vectorIndexed ? null : 'vector_indexing_failed',
          failureCount: 0,
          fulltextSource: 'manual',
        });
      });
      logger.info(`[acquire] Paper ${paperId} manual PDF processing complete ✓`, { resolvedPath, textPath: result.textPath, vectorIndexed: result.vectorIndexed });
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
  fs.mkdirSync(pdfDir, { recursive: true });
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
  const acquireResult = await withRetry(() =>
    acquireService.acquireFulltext({
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
    }),
  );

  // Log every source attempt + record failures to FailureMemory (Feature 2)
  const doiPrefix = extractDoiPrefix(doi);
  for (const attempt of acquireResult.attempts) {
    logger.info(`[acquire] Source attempt: ${attempt.source}`, {
      paperId, status: attempt.status, durationMs: attempt.durationMs,
      failureReason: attempt.failureReason, failureCategory: attempt.failureCategory,
      httpStatus: attempt.httpStatus,
    });

    // 记录失败到 FailureMemory（使用结构化 failureCategory）
    if (failureMemory && acquireConfig.enableFailureMemory && (attempt.status === 'failed' || attempt.status === 'timeout')) {
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

  if (acquireResult.status !== 'success') {
    const reason = acquireResult.attempts
      .map((a) => `${a.source}:${a.failureReason}`)
      .join('; ') || 'all_sources_failed';

    logger.error(`[acquire] All sources failed for ${paperId}: ${reason}`);

    await writeExclusive(async () => {
      await dbProxy.updatePaper(paperId, {
        fulltextStatus: 'failed',
        failureReason: reason.slice(0, 200),
      });
    });
    throw new Error(`Acquire failed: ${reason}`);
  }

  logger.info(`[acquire] Step 1 complete: PDF acquired for ${paperId}`, {
    source: acquireResult.source,
    fileSize: acquireResult.fileSize,
  });

  // Steps 2 (PDF validation) is handled inside AcquireService

  // Clear cascade substeps, switch to processing substeps
  if (runner) {
    runner.reportProgress({
      currentStage: 'extracting',
      substeps: [
        { name: 'extract', status: 'running' },
        { name: 'hydrate', status: 'pending' },
        { name: 'chunk', status: 'pending' },
        { name: 'index', status: 'pending' },
      ],
    });
  }

  // ══ Steps 3-10: Text extraction + hydration + chunking + indexing ══
  const result = await processExtractAndHydrate(paperId, pdfPath, paper, ctx, {
    sanityCheck: { sanityChecker, acquireResult, failureMemory, acquireConfig, doiPrefix, publisher, title, authors, year, doi },
    ...(runner ? { runner } : {}),
  });

  // ══ Step 11: Status update (Zone 3: Write) ══
  logger.info(`[acquire] Step 11: Writing final status for ${paperId}`);
  await writeExclusive(async () => {
    await dbProxy.updatePaper(paperId, {
      ...result.hydratePatch,
      fulltextStatus: result.vectorIndexed ? 'available' : 'acquired',
      fulltextPath: pdfPath,
      textPath: result.textPath,
      failureReason: result.vectorIndexed ? null : 'vector_indexing_failed',
      failureCount: 0, // Reset on success (§5.1.2)
      fulltextSource: acquireResult.source,
    });
  });
  logger.info(`[acquire] Paper ${paperId} acquisition complete ✓`, { source: acquireResult.source, pdfPath, textPath: result.textPath });
}

// ─── Shared processing + hydration pipeline ───

interface ProcessResult {
  textPath: string | null;
  vectorIndexed: boolean;
  hydratePatch: Partial<PaperMetadata>;
}

interface SanityCheckCtx {
  sanityChecker: ContentSanityChecker | null;
  acquireResult: { source: string | null; attempts: Array<{ source: string; failureReason: string | null }> };
  failureMemory: FailureMemory | null;
  acquireConfig: AcquireConfig;
  doiPrefix: string | null;
  publisher: string | null;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
}

/**
 * Unified extraction + hydration pipeline shared by both manual-PDF and download paths.
 *
 * Steps performed:
 * 3.  Text extraction (with OCR fallback)
 * 3b. LLM content sanity check (if sanityCtx provided)
 * 3c. Metadata hydration (multi-source: PDF dict → heuristic → LLM → API → CrossRef)
 * 4.  Section structure recognition
 * 5.  Structure-aware chunking
 * 6-7. Embedding + vector indexing
 * 8.  Reference extraction + persistence
 * 9.  Bibliography enrichment
 */
async function processExtractAndHydrate(
  paperId: string,
  pdfPath: string,
  paper: Record<string, unknown>,
  ctx: AcquireServices & {
    writeExclusive: <R>(fn: () => R | Promise<R>) => Promise<R>;
  },
  opts?: { sanityCheck?: SanityCheckCtx; runner?: WorkflowRunnerContext },
): Promise<ProcessResult> {
  const { processService, logger, workspacePath } = ctx;
  let textPath: string | null = null;
  let vectorIndexed = false;
  let hydratePatch: Partial<PaperMetadata> = {};

  if (processService) {
    logger.info(`[acquire] Steps 3-8: Starting text processing for ${paperId}`);

    // ══ Step 3: Text extraction (§2.5) ══
    const textDir = path.join(workspacePath, 'texts');
    fs.mkdirSync(textDir, { recursive: true });
    textPath = path.join(textDir, `${paperId}.txt`);

    const extraction = await processService.extractText(pdfPath);
    const fullText = extraction.fullText ?? '';

    if (fullText.length < 50) {
      logger.warn(`Paper ${paperId}: extracted text too short (${fullText.length} chars)`);
    }

    // ══ Step 3b: LLM content sanity check (Feature 1) ══
    if (opts?.sanityCheck) {
      const sc = opts.sanityCheck;
      if (sc.sanityChecker && sc.acquireConfig.enableContentSanityCheck && fullText.length > 0) {
        logger.info(`[acquire] Step 3b: Running content sanity check for ${paperId}`);
        const sanityResult = await sc.sanityChecker.check({
          title: sc.title,
          authors: sc.authors,
          year: sc.year,
          doi: sc.doi,
          extractedText: fullText,
          maxChars: sc.acquireConfig.sanityCheckMaxChars,
        });

        if (sanityResult.verdict !== 'pass' && sanityResult.confidence >= sc.acquireConfig.sanityCheckConfidenceThreshold) {
          logger.warn(`[acquire] Step 3b: Sanity check FAILED for ${paperId}`, {
            verdict: sanityResult.verdict,
            confidence: sanityResult.confidence,
            explanation: sanityResult.explanation,
          });

          if (sc.failureMemory && sc.acquireConfig.enableFailureMemory) {
            sc.failureMemory.recordFailure({
              paperId,
              source: sc.acquireResult.source ?? 'unknown',
              failureType: sanityResult.verdict as AcquireFailureType,
              publisher: sc.publisher,
              doiPrefix: sc.doiPrefix,
              detail: `LLM sanity check: ${sanityResult.verdict} — ${sanityResult.explanation}`,
            });
          }

          try { fs.unlinkSync(pdfPath); } catch { /* ignore */ }

          await ctx.writeExclusive(async () => {
            await ctx.dbProxy.updatePaper(paperId, {
              fulltextStatus: 'failed',
              failureReason: `Content sanity check: ${sanityResult.verdict} — ${sanityResult.explanation}`.slice(0, 200),
            });
          });
          throw new Error(`Content sanity check failed: ${sanityResult.verdict} — ${sanityResult.explanation}`);
        }

        logger.info(`[acquire] Step 3b: Sanity check PASSED for ${paperId}`, {
          verdict: sanityResult.verdict,
          confidence: sanityResult.confidence,
        });
      }
    }

    // Write text file atomically (§5.2.3)
    const tmpTextPath = textPath + '.tmp';
    fs.writeFileSync(tmpTextPath, fullText, 'utf-8');
    fs.renameSync(tmpTextPath, textPath);

    // Update substeps: extract done, hydrate running
    if (opts?.runner) {
      opts.runner.reportProgress({
        currentStage: 'hydrating',
        substeps: [
          { name: 'extract', status: 'success' },
          { name: 'hydrate', status: 'running' },
          { name: 'chunk', status: 'pending' },
          { name: 'index', status: 'pending' },
        ],
      });
    }

    // ══ Step 3c: Metadata hydration — fill missing fields from multiple sources ══
    const pdfMeta: PdfEmbeddedMetadata = extraction.pdfMetadata ?? {
      title: null, author: null, subject: null, keywords: null,
      creator: null, producer: null, creationDate: null,
    };
    const firstPage: FirstPageMetadata = extraction.firstPage ?? {
      titleCandidate: null, authorCandidates: [], firstPageText: '',
    };

    // Build a PaperMetadata-like object from the DB record for hydration
    const paperForHydrate = {
      title: (paper['title'] as string) ?? null,
      authors: (paper['authors'] as string[]) ?? [],
      year: (paper['year'] as number) ?? null,
      abstract: (paper['abstract'] as string) ?? null,
      doi: (paper['doi'] as string) ?? null,
      arxivId: (paper['arxivId'] ?? paper['arxiv_id']) as string ?? null,
      pmcid: (paper['pmcid'] as string) ?? null,
      pmid: (paper['pmid'] as string) ?? null,
      venue: (paper['venue'] as string) ?? null,
      journal: (paper['journal'] as string) ?? null,
      volume: (paper['volume'] as string) ?? null,
      issue: (paper['issue'] as string) ?? null,
      pages: (paper['pages'] as string) ?? null,
      publisher: (paper['publisher'] as string) ?? null,
      issn: (paper['issn'] as string) ?? null,
      isbn: (paper['isbn'] as string) ?? null,
      citationCount: (paper['citationCount'] ?? paper['citation_count']) as number ?? null,
      paperType: (paper['paperType'] ?? paper['paper_type'] ?? 'unknown') as string,
    } as PaperMetadata;

    try {
      logger.info(`[acquire] Step 3c: Running metadata hydration for ${paperId}`);
      const hydrateResult = await hydratePaperMetadata(paperForHydrate, pdfMeta, firstPage, {
        llmCall: ctx.llmCallFn,
        lookupService: ctx.lookupService,
        enrichService: ctx.enrichService,
        config: ctx.hydrateConfig,
        logger,
      });

      hydratePatch = hydrateResult.patch;

      // Persist hydration audit log
      if (ctx.hydratePersist && hydrateResult.result.fieldsUpdated.length > 0) {
        try {
          ctx.hydratePersist.insertHydrateLogs(paperId, hydrateResult.result.fieldsUpdated);
        } catch (err) {
          logger.debug(`Paper ${paperId}: hydrate log persistence failed`, { error: (err as Error).message });
        }
      }

      logger.info(`[acquire] Step 3c: Hydration complete for ${paperId}`, {
        fieldsUpdated: hydrateResult.result.fieldsUpdated.length,
        fieldsMissing: hydrateResult.result.fieldsMissing,
      });
    } catch (err) {
      logger.warn(`[acquire] Step 3c: Metadata hydration failed (non-fatal)`, { paperId, error: (err as Error).message });
    }

    // Update substeps: hydrate done, chunk running
    if (opts?.runner) {
      opts.runner.reportProgress({
        currentStage: 'chunking',
        substeps: [
          { name: 'extract', status: 'success' },
          { name: 'hydrate', status: 'success' },
          { name: 'chunk', status: 'running' },
          { name: 'index', status: 'pending' },
        ],
      });
    }

    // ══ Step 4: Section structure recognition (§2.6.1) ══
    const sectionsResult = processService.extractSections(fullText);

    // ══ Step 5: Structure-aware chunking (§2.6.2) ══
    const chunks = processService.chunkText(
      sectionsResult.sectionMap,
      sectionsResult.boundaries,
      extraction.pageTexts ?? [],
    );

    // Update substeps: chunk done, index running
    if (opts?.runner) {
      opts.runner.reportProgress({
        currentStage: 'indexing',
        substeps: [
          { name: 'extract', status: 'success' },
          { name: 'hydrate', status: 'success' },
          { name: 'chunk', status: 'success' },
          { name: 'index', status: 'running' },
        ],
      });
    }

    // ══ Step 6-7: Embedding + vector index (§2.7) ══
    if (ctx.ragService && chunks.length > 0) {
      try {
        await ctx.ragService.indexChunks(paperId, chunks);
        vectorIndexed = true;
      } catch (err) {
        logger.warn(`Paper ${paperId}: vector indexing failed — paper will NOT appear in RAG searches`, {
          error: (err as Error).message,
          chunkCount: chunks.length,
        });
      }
    }

    // ══ Step 8: Reference extraction + persistence (§2.8) ══
    try {
      const references = processService.extractReferences(fullText);
      if (references.length > 0) {
        logger.debug(`Paper ${paperId}: extracted ${references.length} references`);
        // Persist to extracted_references table
        if (ctx.hydratePersist) {
          try {
            ctx.hydratePersist.upsertReferences(paperId, references);
          } catch (err) {
            logger.debug(`Paper ${paperId}: reference persistence failed`, { error: (err as Error).message });
          }
        }
      }
    } catch {
      // Non-fatal
    }
  } else {
    logger.warn(`Paper ${paperId}: processService unavailable, skipping text extraction (steps 3-8)`);
  }

  // ══ Step 9: Bibliography enrichment (§2.9) ══
  if (ctx.bibliographyService) {
    try {
      await ctx.bibliographyService.enrichBibliography(paper);
    } catch (err) {
      logger.debug(`Paper ${paperId}: bibliography enrichment failed`, { error: (err as Error).message });
    }
  }

  // ══ Step 10: VLM figure parsing — optional ══
  // TODO: VLM figure parsing (parseFiguresWithVlm) requires VLM model configuration

  return { textPath, vectorIndexed, hydratePatch };
}
