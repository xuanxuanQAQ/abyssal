/**
 * Analyze workflow — concept-aware deep analysis with mode dispatch.
 *
 * Mode dispatch (§1.3):
 *   zero_concepts → generic analysis (concept discovery only)
 *   medium relevance → intermediate analysis (low-cost structured extraction)
 *   high relevance → full analysis (frontier model, concept mapping)
 *   low/excluded → skip
 *
 * 11-step pipeline (§6):
 * 1.  Precheck + stale in_progress detection (§11.2)
 * 2.  Concept framework context (enhanced 3D subset selection §3)
 * 3.  Memo collection
 * 4.  Cross-paper context retrieval
 * 5.  Annotation read
 * 6.  CBM budget allocation
 * 7.  Prompt assembly (maturity-aware §4)
 * 8.  LLM call (model from router §2)
 * 9.  Output parse + validate
 * 10. Result write (mappings + suggestions with aggregation §6.8 + report)
 * 11. Post-analysis relation computation (§9)
 *
 * See spec: §1-11
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { LlmClient } from '../../llm-client/llm-client';
import type { ContextBudgetManager, FrameworkState } from '../../context-budget/context-budget-manager';
import type { Logger } from '../../../core/infra/logger';
import { PaperNotFoundError } from '../../../core/types/errors';

import {
  formatConceptFramework,
  type ConceptForFormat,
  type MemoForFormat,
} from '../../prompt-assembler/section-formatter';

import { createPromptAssembler } from '../../prompt-assembler/prompt-assembler';
import { formatAnnotations, type AnnotationForFormat } from '../../prompt-assembler/section-formatter';
import { countTokens } from '../../llm-client/token-counter';
import { getModelContextWindow } from '../../llm-client/model-router';

// New modules
import {
  resolveAnalysisRoute,
  type PaperFeatures,
  type AnalyzeStageWorkflowId,
} from './analyze-modes/model-router';
import { runIntermediateAnalysis } from './analyze-modes/intermediate-analysis';
import { runGenericAnalysis } from './analyze-modes/generic-analysis';
import {
  filterConceptSubsetAsync,
  type ConceptForSubset,
  type SubsetSelectorDb,
} from '../../prompt-assembler/concept-subset-selector';
import { buildMaturityInstructions } from './concept-evolution/maturity-evaluator';
import { aggregateSuggestions, type SuggestionDb, type PushNotifier } from './suggested-concepts/suggestion-aggregator';
import {
  ANALYZE_STRUCTURED_RESPONSE_FORMAT,
  parseStructuredAnalyzeOutput,
} from './analyze-structured-output';
import {
  extractArtifactSummary,
  writeAnalysisArtifact,
  type AnalysisArtifactQualityWarning,
} from './analysis-artifact';
import { resolveCurrentRagService } from './rag-service-resolver';

// ─── Services interface ───

export interface AnalyzeServices {
  dbProxy: {
    queryPapers: (filter: unknown) => Promise<{ items: Array<Record<string, unknown>> }>;
    getPaper: (id: unknown) => Promise<Record<string, unknown> | null>;
    updatePaper: (id: unknown, fields: unknown) => Promise<void>;
    getAllConcepts: () => Promise<Array<Record<string, unknown>>>;
    getMemosByEntity: (type: string, id: string) => Promise<Array<Record<string, unknown>>>;
    getAnnotations: (paperId: unknown) => Promise<unknown[]>;
    mapPaperConcept: (mapping: unknown) => Promise<void>;
    mapPaperConceptBatch: (mappings: unknown[]) => Promise<void>;
    addSuggestedConcept: (suggestion: unknown) => Promise<void>;
    getConcept: (id: unknown) => Promise<Record<string, unknown> | null>;
    getStats: () => Promise<{ concepts: { total: number; tentative: number; working: number; established: number } }>;
    // Enhanced queries for subset selection and relations
    getCitationsFrom?: (paperId: string) => Promise<string[]>;
    getCitationsTo?: (paperId: string) => Promise<string[]>;
    countMappingsForConceptInPapers?: (conceptId: string, paperIds: string[]) => Promise<number>;
    countAnnotationsForPaperConcept?: (paperId: string, conceptId: string) => Promise<number>;
    batchCountAnnotationsByPaper?: (paperId: string) => Promise<Map<string, number>>;
    batchCountMappingsByPapers?: (paperIds: string[]) => Promise<Map<string, number>>;
    computeRelationsForPaper?: (paperId: string, semanticSearchFn: unknown) => Promise<void>;
    getSuggestedConceptByTerm?: (termNormalized: string) => Promise<Record<string, unknown> | null>;
    insertSuggestedConcept?: (data: Record<string, unknown>) => Promise<void>;
    updateSuggestedConcept?: (id: string, updates: Record<string, unknown>) => Promise<void>;
    getSeeds?: () => Promise<Array<Record<string, unknown>>>;
    /** Atomic: write mappings + update status in single transaction */
    completeAnalysis: (paperId: unknown, mappings: unknown[], status: string, failureReason?: string | null) => Promise<void>;
  };
  llmClient: LlmClient;
  contextBudgetManager: ContextBudgetManager;
  ragService?: {
    retrieve: (query: string, options?: { paperId?: string; topK?: number }) => Promise<{
      passages: Array<{ text: string; paperId: string; score: number; chunkId?: string }>;
      qualityReport?: { coverage: string; retryCount: number; gaps: string[] } | null;
    }>;
  } | null;
  getRagService?: (() => AnalyzeServices['ragService']) | undefined;
  logger: Logger;
  frameworkState: FrameworkState | (() => FrameworkState);
  workspacePath: string;
  pushNotifier?: PushNotifier | null;
  modelRouterConfig?: { frontierModel: string; lowCostModel: string };
  outputLanguage?: string | undefined;
  analysisConfig?: { autoSuggestConcepts?: boolean; autoSuggestThreshold?: number };
}

type AnalyzeSingleResult =
  | { status: 'completed' }
  | { status: 'skipped' }
  | { status: 'deferred' }
  | { status: 'cancelled' }
  | { status: 'failed'; stage: string; message: string };

// ─── Workflow ───

export function createAnalyzeWorkflow(services: AnalyzeServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath } = services;
    const frameworkState = typeof services.frameworkState === 'function'
      ? services.frameworkState()
      : services.frameworkState;
    const modelRouterConfig = {
      frontierModel: services.modelRouterConfig?.frontierModel ?? llmClient.resolveModel('analyze.full'),
      lowCostModel: services.modelRouterConfig?.lowCostModel ?? llmClient.resolveModel('analyze.intermediate'),
    };

    // ── §11.2: Stale in_progress detection ──
    // Only reset papers that are in_progress but have NO active in-memory task.
    // This prevents killing legitimate slow-running analysis (e.g., local models
    // that take >1h, or tasks that spanned system sleep/hibernate).
    // At workflow START, we know no tasks are running yet in THIS process —
    // any in_progress state was left by a previous crashed/killed process.
    try {
      const staleResult = await dbProxy.queryPapers({
        analysisStatus: ['in_progress'],
        limit: 100,
      });
      if (staleResult.items.length > 0) {
        logger.warn(
          `Found ${staleResult.items.length} papers stuck in in_progress (previous crash?), resetting to not_started`,
        );
        for (const p of staleResult.items) {
          await dbProxy.updatePaper(p['id'] as string, { analysisStatus: 'not_started' });
        }
      }
    } catch (err) {
      logger.warn('Stale in_progress detection failed', { error: (err as Error).message });
    }

    // Determine papers to analyze
    let paperIds = options.paperIds;
    if (!paperIds || paperIds.length === 0) {
      const result = await dbProxy.queryPapers({
        analysisStatus: ['not_started', 'failed', 'needs_review'],
        fulltextStatus: ['available'],
        limit: 1000,
      });
      paperIds = result.items.map((p) => p['id'] as string);
    }

    runner.setTotal(paperIds.length);
    logger.info(`[analyze] Batch starting`, {
      paperCount: paperIds.length,
      frameworkState,
      concurrency: options.concurrency ?? 3,
    });
    if (paperIds.length === 0) return;

    // Load concept framework once (shared across papers)
    // §3 Fix: Snapshot concept version at batch start for staleness detection
    const allConcepts = (await dbProxy.getAllConcepts()) as Array<Record<string, unknown>>;
    const conceptsForSubset: ConceptForSubset[] = allConcepts
      .filter((c) => !c['deprecated'])
      .map((c) => mapConceptRecord(c));
    const conceptsForPrompt: ConceptForFormat[] = conceptsForSubset.map((c) => ({
      id: c.id, nameEn: c.nameEn, nameZh: c.nameZh,
      definition: c.definition, searchKeywords: c.searchKeywords, maturity: c.maturity,
    }));

    // Concept version fingerprint: detect if concepts changed during batch
    const conceptSnapshotHash = computeConceptHash(conceptsForSubset);
    const maturityCounts = { tentative: 0, working: 0, established: 0 };
    for (const c of conceptsForSubset) maturityCounts[c.maturity]++;
    logger.info(`[analyze] Concept framework snapshot`, {
      totalConcepts: conceptsForSubset.length,
      ...maturityCounts,
      snapshotHash: conceptSnapshotHash,
    });

    // Resolve seed types for model routing
    let seedPaperIds = new Set<string>();
    let axiomPaperIds = new Set<string>();
    if (dbProxy.getSeeds) {
      try {
        const seeds = await dbProxy.getSeeds();
        for (const s of seeds) {
          const pid = s['paperId'] as string;
          seedPaperIds.add(pid);
          const stype = s['seedType'] as string;
          if (stype === 'axiom') axiomPaperIds.add(pid);
        }
      } catch (err) {
        logger.debug('Seed fetch failed, routing without seed info', { error: (err as Error).message });
      }
    }

    // Pre-fetch citation neighbors for all papers (parallelized)
    const citationCache = new Map<string, string[]>();
    if (dbProxy.getCitationsFrom && dbProxy.getCitationsTo) {
      const citationPromises = paperIds.map(async (pid) => {
        try {
          const [from, to] = await Promise.all([
            dbProxy.getCitationsFrom!(pid),
            dbProxy.getCitationsTo!(pid),
          ]);
          citationCache.set(pid, [...new Set([...from, ...to])]);
        } catch (err) {
          logger.debug(`Citation fetch failed for ${pid}`, { error: (err as Error).message });
        }
      });
      await Promise.all(citationPromises);
      logger.debug(`[analyze] Citation cache pre-fetched`, { papers: paperIds.length, cached: citationCache.size });
    }

    // Pre-fetch annotation counts and mapping counts for subset selection.
    // Uses batch queries (1 SQL per paper) instead of Cartesian product (papers × concepts).
    const annotationCountCache = new Map<string, number>(); // `${paperId}:${conceptId}` → count
    const mappingCountCache = new Map<string, number>(); // `${conceptId}:${neighborKey}` → count

    if (paperIds.length > 0 && conceptsForSubset.length > 0) {
      // Batch annotation counts: 1 query per paper (GROUP BY concept_id)
      if (dbProxy.batchCountAnnotationsByPaper) {
        const promises = paperIds.map(async (pid) => {
          try {
            const counts = await dbProxy.batchCountAnnotationsByPaper!(pid);
            for (const [conceptId, count] of counts) {
              annotationCountCache.set(`${pid}:${conceptId}`, count);
            }
          } catch (err) {
            logger.debug(`Annotation batch pre-fetch failed for ${pid}`, { error: (err as Error).message });
          }
        });
        await Promise.all(promises);
      } else if (dbProxy.countAnnotationsForPaperConcept) {
        // Fallback: individual queries (for backward compatibility)
        const promises: Array<Promise<void>> = [];
        for (const pid of paperIds) {
          for (const c of conceptsForSubset) {
            promises.push(
              dbProxy.countAnnotationsForPaperConcept(pid, c.id)
                .then((count: number) => { if (count > 0) annotationCountCache.set(`${pid}:${c.id}`, count); })
                .catch((err: unknown) => { logger.debug(`Annotation count failed: ${pid}:${c.id}`, { error: (err as Error).message }); }),
            );
          }
        }
        await Promise.all(promises);
      }
      logger.debug(`[analyze] Annotation count cache pre-fetched`, { nonZeroEntries: annotationCountCache.size });

      // Batch mapping counts: 1 query per unique neighbor set (GROUP BY concept_id)
      if (citationCache.size > 0) {
        if (dbProxy.batchCountMappingsByPapers) {
          // Deduplicate neighbor sets to avoid redundant queries
          const processedSets = new Set<string>();
          const promises: Array<Promise<void>> = [];
          for (const pid of paperIds) {
            const neighbors = citationCache.get(pid);
            if (!neighbors || neighbors.length === 0) continue;
            const sortedNeighbors = [...neighbors].sort();
            const setKey = sortedNeighbors.join(',');
            if (processedSets.has(setKey)) continue;
            processedSets.add(setKey);
            promises.push(
              dbProxy.batchCountMappingsByPapers!(sortedNeighbors)
                .then((counts) => {
                  for (const [conceptId, count] of counts) {
                    mappingCountCache.set(`${conceptId}:${setKey}`, count);
                  }
                })
                .catch((err: unknown) => { logger.debug(`Mapping batch pre-fetch failed`, { error: (err as Error).message }); }),
            );
          }
          await Promise.all(promises);
        } else if (dbProxy.countMappingsForConceptInPapers) {
          // Fallback: individual queries
          const uniqueNeighborSets = new Map<string, string[]>();
          for (const pid of paperIds) {
            const neighbors = citationCache.get(pid);
            if (neighbors && neighbors.length > 0) uniqueNeighborSets.set(pid, neighbors);
          }
          const promises: Array<Promise<void>> = [];
          for (const [, neighbors] of uniqueNeighborSets) {
            for (const c of conceptsForSubset) {
              promises.push(
                dbProxy.countMappingsForConceptInPapers(c.id, neighbors)
                  .then((count: number) => {
                    if (count > 0) {
                      mappingCountCache.set(`${c.id}:${neighbors.sort().join(',')}`, count);
                    }
                  })
                  .catch((err: unknown) => { logger.debug(`Mapping count failed: ${c.id}`, { error: (err as Error).message }); }),
              );
            }
          }
          await Promise.all(promises);
        }
        logger.debug(`[analyze] Mapping count cache pre-fetched`, { nonZeroEntries: mappingCountCache.size });
      }
    }

    // Build sync subset selector DB adapter with pre-fetched data
    const subsetDb: SubsetSelectorDb | null = {
      countAnnotationsForConcept: (paperId: string, conceptId: string): number => {
        return annotationCountCache.get(`${paperId}:${conceptId}`) ?? 0;
      },
      getCitationNeighbors: (paperId: string): string[] => {
        return citationCache.get(paperId) ?? [];
      },
      countMappingsForConcept: (conceptId: string, paperIds: string[]): number => {
        const cacheKey = `${conceptId}:${paperIds.sort().join(',')}`;
        return mappingCountCache.get(cacheKey) ?? 0;
      },
    };

    // Embedder for semantic neighbor supplement in subset selection
    const embedder = llmClient.asEmbedFunction?.() ?? null;

    const isZeroConcepts = frameworkState === 'zero_concepts';
    const concurrency = options.concurrency ?? 3;
    const upgradeQueue: string[] = []; // Papers needing upgrade from intermediate → full
    const upgradeQueueSeen = new Set<string>(); // Dedup guard for upgradeQueue
    const completedPaperIds: string[] = []; // Track for post-batch relation computation
    const ragService = resolveCurrentRagService(services);

    // Worker-pool pattern
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paperIds!.length) {
        if (runner.signal.aborted) break;
        const paperId = paperIds![nextIndex++]!;

        runner.reportProgress({ currentItem: paperId, currentStage: 'checking' });

        try {
          const outcome = await analyzeSinglePaper(paperId, {
            dbProxy,
            llmClient,
            contextBudgetManager,
            logger,
            workspacePath,
            frameworkState,
            conceptsForPrompt,
            conceptsForSubset,
            isZeroConcepts,
            runner,
            subsetDb,
            embedder,
            ragService,
            seedPaperIds,
            axiomPaperIds,
            upgradeQueue,
            upgradeQueueSeen,
            pushNotifier: services.pushNotifier ?? null,
            modelRouterConfig,
            force: false,
            outputLanguage: services.outputLanguage,
            conceptSnapshotHash,
            autoSuggestConcepts: services.analysisConfig?.autoSuggestConcepts ?? true,
            autoSuggestThreshold: services.analysisConfig?.autoSuggestThreshold ?? 3,
          });

          if (outcome.status === 'completed') {
            completedPaperIds.push(paperId);
            runner.reportComplete(paperId);
          } else if (outcome.status === 'failed') {
            runner.reportFailed(paperId, outcome.stage, new Error(outcome.message));
          } else if (outcome.status === 'cancelled') {
            logger.info(`[analyze] Paper ${paperId}: cancelled`);
          }
        } catch (error) {
          if (isAbortError(error, runner.signal)) {
            logger.info(`[analyze] Paper ${paperId}: cancelled during execution`);
            break;
          }
          runner.reportFailed(paperId, 'analyze', error as Error);
          try {
            await dbProxy.updatePaper(paperId, {
              analysisStatus: 'failed',
              failureReason: (error as Error).message.slice(0, 200),
            });
          } catch (dbErr) { logger.debug(`Paper ${paperId}: status update failed during error handling`, { error: (dbErr as Error).message }); }
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    logger.info(`[analyze] Worker pool finished`, {
      completed: completedPaperIds.length,
      failed: runner.progress.failedItems,
      skipped: runner.progress.skippedItems,
      upgradeQueueSize: upgradeQueue.length,
    });

    // ── Post-batch: deferred relation computation ──
    // Relations are computed after ALL papers are analyzed, not per-paper.
    // This avoids O(N²) write amplification when hot concepts have 1000+ mappings.
    // The relation graph is a derived display index — not needed for RAG or analysis.
    if (completedPaperIds.length > 0 && dbProxy.computeRelationsForPaper) {
      logger.info(`Computing relations for ${completedPaperIds.length} newly analyzed papers...`);
      for (const pid of completedPaperIds) {
        if (runner.signal.aborted) break;
        try {
          await dbProxy.computeRelationsForPaper(pid, null);
        } catch (err) {
          logger.debug(`Relation computation failed for ${pid}: ${(err as Error).message}`);
        }
      }
    }

    // Process upgrade queue — re-analyze papers that intermediate analysis recommended for full
    if (upgradeQueue.length > 0 && !runner.signal.aborted) {
      logger.info(`Processing ${upgradeQueue.length} papers upgraded from intermediate to full analysis`);
      for (const pid of upgradeQueue) {
        if (runner.signal.aborted) break;
        try {
          // Reset status so full analysis picks them up
          await dbProxy.updatePaper(pid, { analysisStatus: 'not_started', failureReason: null });
          const outcome = await analyzeSinglePaper(pid, {
            dbProxy,
            llmClient,
            contextBudgetManager,
            logger,
            workspacePath,
            frameworkState,
            conceptsForPrompt,
            conceptsForSubset,
            isZeroConcepts: false, // upgraded → always full
            runner,
            subsetDb,
            embedder,
            ragService,
            seedPaperIds,
            axiomPaperIds,
            upgradeQueue: [], // prevent recursive upgrades
            upgradeQueueSeen: new Set(), // empty — no further upgrades
            pushNotifier: services.pushNotifier ?? null,
            modelRouterConfig,
            force: true,
            outputLanguage: services.outputLanguage,
            conceptSnapshotHash,
            autoSuggestConcepts: services.analysisConfig?.autoSuggestConcepts ?? true,
            autoSuggestThreshold: services.analysisConfig?.autoSuggestThreshold ?? 3,
          });

          if (outcome.status === 'completed') {
            completedPaperIds.push(pid);
            runner.reportComplete(pid);
          } else if (outcome.status === 'failed') {
            runner.reportFailed(pid, outcome.stage, new Error(outcome.message));
          } else if (outcome.status === 'cancelled') {
            logger.info(`[analyze] Paper ${pid}: cancelled during upgrade`);
            break;
          }
        } catch (err) {
          if (isAbortError(err, runner.signal)) {
            logger.info(`[analyze] Paper ${pid}: cancelled during upgrade`);
            break;
          }
          logger.warn(`Upgrade analysis failed for ${pid}: ${(err as Error).message}`);
        }
      }
    }
  };
}

// ─── Single paper analysis with mode dispatch ───

async function analyzeSinglePaper(
  paperId: string,
  ctx: {
    dbProxy: AnalyzeServices['dbProxy'];
    llmClient: LlmClient;
    contextBudgetManager: ContextBudgetManager;
    logger: Logger;
    workspacePath: string;
    frameworkState: FrameworkState;
    conceptsForPrompt: ConceptForFormat[];
    conceptsForSubset: ConceptForSubset[];
    isZeroConcepts: boolean;
    runner: WorkflowRunnerContext;
    subsetDb: SubsetSelectorDb | null;
    embedder: import('../../prompt-assembler/concept-subset-selector').SubsetEmbedder | null;
    ragService: AnalyzeServices['ragService'];
    seedPaperIds: Set<string>;
    axiomPaperIds: Set<string>;
    upgradeQueue: string[];
    upgradeQueueSeen: Set<string>;
    pushNotifier: PushNotifier | null;
    modelRouterConfig: { frontierModel: string; lowCostModel: string };
    force: boolean;
    outputLanguage?: string | undefined;
    conceptSnapshotHash: string;
    autoSuggestConcepts: boolean;
    autoSuggestThreshold: number;
  },
): Promise<AnalyzeSingleResult> {
  const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath, runner } = ctx;
  const qualityWarnings: AnalysisArtifactQualityWarning[] = [];
  const reportQualityWarning = (
    type: AnalysisArtifactQualityWarning['type'],
    message: string,
  ) => {
    qualityWarnings.push({ type, message });
    runner.reportQualityWarning(paperId, type, message);
  };

  // ══ Step 1: Precheck (§6.1) ══
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) throw new PaperNotFoundError({ message: `Paper not found: ${paperId}` });

  const analysisStatus = paper['analysisStatus'] as string | undefined;
  if (analysisStatus === 'completed' && !ctx.force) {
    runner.reportSkipped(paperId);
    return { status: 'skipped' };
  }

  let fulltextStatus = paper['fulltextStatus'] as string | undefined;
  if (fulltextStatus === 'acquired') {
    fulltextStatus = 'available';
    try {
      await dbProxy.updatePaper(paperId, { fulltextStatus: 'available' } as Record<string, unknown>);
    } catch (err) {
      logger.debug(`Paper ${paperId}: failed to normalize legacy acquired status`, { error: (err as Error).message });
    }
  }
  if (fulltextStatus !== 'available') {
    logger.warn(`Paper ${paperId}: fulltext not acquired, skipping`);
    runner.reportSkipped(paperId);
    return { status: 'skipped' };
  }

  if (runner.signal.aborted) {
    return { status: 'cancelled' };
  }

  const previousAnalysisStatus = normalizeAnalysisStatusForResume(analysisStatus);
  await dbProxy.updatePaper(paperId, { analysisStatus: 'in_progress' });

  try {

  const textPath = path.join(workspacePath, 'texts', `${paperId}.txt`);
  let fullText = '';
  try {
    fullText = await fsp.readFile(textPath, 'utf-8');
  } catch {
    logger.warn(`Paper ${paperId}: fulltext file not found at ${textPath}`);
  }

  const paperTitle = (paper['title'] as string) ?? '';
  const paperType = (paper['paperType'] as string) ?? 'unknown';
  const relevance = (paper['relevance'] as string) ?? 'medium';

  logger.debug(`[analyze] Paper ${paperId}: starting`, {
    paperTitle: paperTitle.slice(0, 80),
    paperType,
    relevance,
    fulltextLength: fullText.length,
    isZeroConcepts: ctx.isZeroConcepts,
  });

  // ══ §1.3: Mode dispatch ══
  if (ctx.isZeroConcepts) {
    // ── Generic analysis mode (§5) ──
    logger.debug(`[analyze] Paper ${paperId}: mode=generic (zero concepts)`);
    runner.reportProgress({ currentStage: 'generic_analysis' });

    const memos = await collectMemos(dbProxy, paperId);
    const rawAnnotations = await dbProxy.getAnnotations(paperId);

    const allocation = contextBudgetManager.allocate({
      taskType: 'analyze',
      model: ctx.modelRouterConfig.frontierModel,
      modelContextWindow: getModelContextWindow(ctx.modelRouterConfig.frontierModel),
      costPreference: 'balanced',
      sources: [
        { sourceType: 'paper_fulltext' as const, estimatedTokens: countTokens(fullText), priority: 'HIGH' as const, content: fullText },
        { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memos.map((m) => m.text).join('\n')), priority: 'ABSOLUTE' as const, content: null },
      ],
      conceptMaturities: [],
      frameworkState: ctx.frameworkState,
    });

    if (allocation.truncated) {
      reportQualityWarning('context_truncated', buildTruncationWarning(allocation.truncationDetails));
    }

    const genericResult = await runGenericAnalysis(
      paperId, paperTitle, paperType, fullText,
      rawAnnotations as Array<Record<string, unknown>>,
      memos, allocation, llmClient, logger, workspacePath,
      'analyze.generic',
      ctx.modelRouterConfig.frontierModel,
      ctx.outputLanguage,
      runner.signal,
    );

    if (!genericResult.success) {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'parse_failed' });
      return { status: 'failed', stage: 'generic_analysis', message: 'Generic analysis parse failed' };
    }

    // Write suggestions via aggregator (guarded by autoSuggestConcepts config)
    if (ctx.autoSuggestConcepts) {
      await writeSuggestions(genericResult.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger, ctx.autoSuggestThreshold);
    }

    writeAnalysisArtifact(
      {
        version: 2,
        paperId,
        stage: 'analyze.generic',
        mode: 'generic',
        businessStatus: 'completed',
        model: genericResult.model,
        summary: extractArtifactSummary(genericResult.summary, genericResult.body),
        body: genericResult.body,
        warnings: genericResult.warnings,
        qualityWarnings,
        metrics: {
          conceptMappingCount: 0,
          suggestedConceptCount: genericResult.suggestedConcepts.length,
          truncated: allocation.truncated,
        },
        parse: {
          rawPath: genericResult.rawPath,
        },
        generatedAt: new Date().toISOString(),
      },
      workspacePath,
      logger,
    );

    // Write report
    const genericReportPath = writeReport(paperId, genericResult.body, workspacePath);
    await dbProxy.updatePaper(paperId, {
      analysisStatus: 'completed',
      ...(genericReportPath && { analysisPath: genericReportPath }),
    });
    return { status: 'completed' };
  }

  // ── Model routing (§2) ──
  const seedType = ctx.axiomPaperIds.has(paperId) ? 'axiom' as const
    : ctx.seedPaperIds.has(paperId) ? 'milestone' as const
    : null;

  const features: PaperFeatures = {
    relevance: relevance as PaperFeatures['relevance'],
    paperType,
    seedType,
  };

  const route = ctx.force
    ? {
        mode: 'full' as const,
        workflowId: 'analyze.full' as const,
        reason: 'forced_full_upgrade',
      }
    : analysisStatus === 'needs_review' && !ctx.force
    ? {
        mode: 'full' as const,
        workflowId: 'analyze.full' as const,
        reason: 'needs_review_resume_full',
      }
    : resolveAnalysisRoute(features);
  const routeModel = resolveStageModel(route.workflowId, ctx.modelRouterConfig);
  logger.debug(`[analyze] Paper ${paperId}: route decision`, {
    mode: route.mode,
    workflowId: route.workflowId,
    model: routeModel,
    reason: route.reason,
    relevance,
    paperType,
    seedType,
  });

  if (route.mode === 'skip') {
    runner.reportSkipped(paperId);
    await dbProxy.updatePaper(paperId, { analysisStatus: 'completed' });
    return { status: 'skipped' };
  }

  if (route.mode === 'intermediate') {
    // ── Intermediate analysis (§2.2) ──
    runner.reportProgress({ currentStage: 'intermediate_analysis' });

    const intermediateResult = await runIntermediateAnalysis(
      paperId, fullText, paperTitle, llmClient, logger, workspacePath,
      route.workflowId ?? 'analyze.intermediate',
      routeModel ?? ctx.modelRouterConfig.lowCostModel,
      runner.signal,
    );

    if (intermediateResult) {
      const intermediateStatus = intermediateResult.recommendDeepAnalysis ? 'needs_review' : 'completed';
      if (intermediateResult.inputTruncated) {
        reportQualityWarning('context_truncated', intermediateResult.truncationMessage);
      }
      writeAnalysisArtifact(
        {
          version: 2,
          paperId,
          stage: route.workflowId ?? 'analyze.intermediate',
          mode: 'intermediate',
          businessStatus: intermediateStatus,
          model: intermediateResult.model,
          summary: extractArtifactSummary(intermediateResult.summary, intermediateResult.body),
          body: intermediateResult.body,
          warnings: [],
          qualityWarnings,
          metrics: {
            conceptMappingCount: 0,
            suggestedConceptCount: 0,
            truncated: intermediateResult.inputTruncated,
          },
          extra: {
            paperType: intermediateResult.paperType,
            coreClaims: intermediateResult.coreClaims,
            methodSummary: intermediateResult.methodSummary,
            keyConcepts: intermediateResult.keyConcepts,
            potentialRelevance: intermediateResult.potentialRelevance,
            recommendDeepAnalysis: intermediateResult.recommendDeepAnalysis,
          },
          generatedAt: new Date().toISOString(),
        },
        workspacePath,
        logger,
      );
      const intermediateReportPath = writeReport(paperId, intermediateResult.body, workspacePath);
      await dbProxy.updatePaper(paperId, {
        analysisStatus: intermediateStatus,
        failureReason: null,
        ...(intermediateReportPath && { analysisPath: intermediateReportPath }),
      });
      if (intermediateResult.recommendDeepAnalysis && !ctx.upgradeQueueSeen.has(paperId)) {
        ctx.upgradeQueueSeen.add(paperId);
        ctx.upgradeQueue.push(paperId);
        return { status: 'deferred' };
      }
      return { status: 'completed' };
    } else {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'intermediate_parse_failed' });
      return { status: 'failed', stage: 'intermediate_analysis', message: 'Intermediate analysis parse failed' };
    }
  }

  // ══ Full analysis mode ══
  runner.reportProgress({ currentStage: 'preparing_context' });

  // ── Step 2: Concept framework with async 6D selection (§3) ──
  const paperCtx = { id: paperId, title: paperTitle, abstract: (paper['abstract'] as string) ?? '' };

  const subsetResult = await filterConceptSubsetAsync(
    ctx.conceptsForSubset, paperCtx, ctx.subsetDb, ctx.embedder,
  );
  const conceptSubset: ConceptForFormat[] = subsetResult.concepts.map((c) => ({
    id: c.id, nameEn: c.nameEn, nameZh: c.nameZh,
    definition: c.definition, searchKeywords: c.searchKeywords, maturity: c.maturity,
  }));
  logger.debug(`[analyze] Paper ${paperId}: concept subset selected`, {
    totalConcepts: ctx.conceptsForSubset.length,
    selectedConcepts: conceptSubset.length,
    fullInjection: subsetResult.fullInjection,
    hasCrossDisciplineInstruction: !!subsetResult.extraInstruction,
    selectedIds: conceptSubset.slice(0, 5).map((c) => c.id),
  });

  // ── Step 3: Memo collection ──
  const memosForPrompt = await collectMemos(dbProxy, paperId);

  // ── Step 4: Cross-paper context retrieval ──
  let ragPassages: Array<{ text: string; paperId: string; score: number; chunkId?: string }> = [];
  let ragQualityReport: { coverage: string; retryCount: number; gaps: string[] } | null = null;
  if (ctx.ragService) {
    try {
      const query = `${paperTitle} ${(paper['abstract'] as string ?? '').slice(0, 300)}`;
      const ragResult = await ctx.ragService.retrieve(query, { paperId, topK: 10 });
      // Filter out self-references
      ragPassages = ragResult.passages.filter((p) => p.paperId !== paperId);
      ragQualityReport = ragResult.qualityReport ?? null;

      // Propagate RAG quality warnings to UI
      if (ragQualityReport && ragQualityReport.coverage !== 'sufficient') {
        reportQualityWarning(
          'rag_degraded',
          `RAG coverage: ${ragQualityReport.coverage}, gaps: ${ragQualityReport.gaps.join('; ')}, passages: ${ragPassages.length}`,
        );
      }
    } catch (err) {
      ragQualityReport = { coverage: 'insufficient', retryCount: 0, gaps: ['RAG retrieval failed entirely'] };
      reportQualityWarning('rag_degraded', `RAG retrieval failed: ${(err as Error).message}`);
    }
  }

  // ── Step 5: Annotations ──
  const rawAnnotations = await dbProxy.getAnnotations(paperId);
  const annotationsForFormat = formatRawAnnotations(rawAnnotations as Array<Record<string, unknown>>);
  const annotationText = formatAnnotations(annotationsForFormat);

  // ── Step 6: CBM decision ──
  runner.reportProgress({ currentStage: 'budgeting' });

  // Compute excluded concept names for compact display in the prompt
  const selectedIds = new Set(conceptSubset.map((c) => c.id));
  const excludedNames = ctx.conceptsForSubset
    .filter((c) => !selectedIds.has(c.id))
    .map((c) => c.nameEn);

  const conceptFrameworkText = formatConceptFramework(conceptSubset, excludedNames.length > 0 ? excludedNames : undefined);
  const memoText = memosForPrompt.map((m) => m.text).join('\n');
  const conceptMaturities = conceptSubset.map((c) => c.maturity);
  const ragText = ragPassages.map((p) => p.text).join('\n');

  // Resolve maturity-driven parameters (§4)
  const maturityInstructions = buildMaturityInstructions(conceptMaturities);

  const sources: Array<{ sourceType: string; estimatedTokens: number; priority: string; content: unknown }> = [
    { sourceType: 'paper_fulltext' as const, estimatedTokens: countTokens(fullText), priority: 'HIGH' as const, content: fullText },
    { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memoText), priority: 'ABSOLUTE' as const, content: memoText },
    { sourceType: 'researcher_annotations' as const, estimatedTokens: countTokens(annotationText), priority: 'ABSOLUTE' as const, content: annotationText },
    { sourceType: 'concept_framework' as const, estimatedTokens: countTokens(conceptFrameworkText), priority: 'ABSOLUTE' as const, content: conceptFrameworkText },
  ];

  // Include RAG passages if available
  if (ragText.length > 0) {
    sources.push({
      sourceType: 'rag_passages' as const,
      estimatedTokens: countTokens(ragText),
      priority: 'HIGH' as const,
      content: ragText,
    });
  }

  const allocation = contextBudgetManager.allocate({
    taskType: 'analyze',
    model: routeModel ?? ctx.modelRouterConfig.frontierModel,
    modelContextWindow: getModelContextWindow(routeModel ?? ctx.modelRouterConfig.frontierModel),
    costPreference: 'balanced',
    sources: sources as any,
    conceptMaturities,
    frameworkState: ctx.frameworkState,
  });
  logger.debug(`[analyze] Paper ${paperId}: budget allocated`, {
    strategy: allocation.strategy,
    totalBudget: allocation.totalBudget,
    outputReserve: allocation.outputReserve,
    sources: sources.map((s) => ({ type: s.sourceType, tokens: s.estimatedTokens })),
    ragPassages: ragPassages.length,
    memoCount: memosForPrompt.length,
    annotationCount: annotationsForFormat.length,
  });

  // ── Step 7: Prompt assembly (§4 maturity-aware) ──
  runner.reportProgress({ currentStage: 'prompting' });

  const tokenCounter = { count: (text: string) => countTokens(text) };
  const assembler = createPromptAssembler(tokenCounter, logger);

  const assembled = assembler.assemble({
    taskType: 'analyze',
    allocation,
    frameworkState: ctx.frameworkState,
    paperId,
    paperType,
    paperTitle,
    conceptFramework: conceptSubset.map((c) => ({
      id: c.id, nameEn: c.nameEn, nameZh: c.nameZh,
      definition: c.definition, searchKeywords: c.searchKeywords, maturity: c.maturity,
    })),
    memos: memosForPrompt.map((m) => ({ text: m.text, createdAt: m.createdAt, conceptIds: m.conceptIds, paperIds: m.paperIds })),
    annotations: annotationsForFormat,
    paperContent: fullText,
    ragPassages: ragPassages.map((p, i) => ({
      ...p,
      chunkId: p.chunkId ?? `rag-${paperId}-${i}`,
    })),
    outputLanguage: ctx.outputLanguage,
  });

  if (assembled.truncated || allocation.truncated) {
    reportQualityWarning(
      'context_truncated',
      buildTruncationWarning([
        ...allocation.truncationDetails,
        ...assembled.truncationDetails,
      ]),
    );
  }

  // Inject maturity-specific instructions into system prompt
  if (maturityInstructions) {
    assembled.systemPrompt = assembled.systemPrompt + '\n\n' + maturityInstructions;
  }

  // Inject cross-discipline instruction from subset selection
  if (subsetResult.extraInstruction) {
    assembled.systemPrompt = assembled.systemPrompt + '\n\n' + subsetResult.extraInstruction;
  }

  // ── Abort check before expensive LLM call ──
  if (runner.signal.aborted) {
    await restoreAnalysisStatusAfterCancellation(dbProxy, paperId, previousAnalysisStatus, logger);
    return { status: 'cancelled' };
  }

  // ── Step 8: LLM call ──
  runner.reportProgress({ currentStage: 'analyzing' });

  const systemTokens = countTokens(assembled.systemPrompt);
  const userTokens = countTokens(assembled.userMessage);
  logger.debug(`[analyze] Paper ${paperId}: LLM call starting`, {
    workflowId: route.workflowId,
    model: routeModel,
    systemPromptTokens: systemTokens,
    userMessageTokens: userTokens,
    totalInputTokens: systemTokens + userTokens,
  });

  const llmStartMs = Date.now();
  const result = await llmClient.complete({
    systemPrompt: assembled.systemPrompt,
    messages: [{ role: 'user', content: assembled.userMessage }],
    workflowId: route.workflowId ?? 'analyze.full',
    model: routeModel ?? ctx.modelRouterConfig.frontierModel,
    responseFormat: ANALYZE_STRUCTURED_RESPONSE_FORMAT,
    signal: runner.signal,
  });
  const llmLatencyMs = Date.now() - llmStartMs;

  logger.info(`[analyze] Paper ${paperId}: LLM responded`, {
    model: result.model,
    outputLength: result.text.length,
    outputTokens: countTokens(result.text),
    latencyMs: llmLatencyMs,
    hasReasoning: !!result.reasoning,
  });

  // ── Step 9: Output parsing with validation ──
  runner.reportProgress({ currentStage: 'parsing' });

  const validated = parseStructuredAnalyzeOutput(result.text, {
    paperId,
    model: result.model,
    workflow: route.workflowId ?? 'analyze.full',
    frameworkState: ctx.frameworkState,
    workspaceRoot: workspacePath,
    knownConceptIds: new Set(ctx.conceptsForPrompt.map((concept) => concept.id)),
    getConceptName: (conceptId: string) => {
      const concept = ctx.conceptsForPrompt.find((entry) => entry.id === conceptId);
      return concept?.nameEn || concept?.nameZh || null;
    },
    conceptLookup: ctx.conceptsForPrompt.length > 0 ? {
      exists: (cid: string) => ctx.conceptsForPrompt.some((c) => c.id === cid),
    } : undefined,
  }, logger);

  if (!validated.success) {
    logger.warn(`Paper ${paperId}: parse_failed`, {
      diagnostics: validated.diagnostics,
      rawPath: validated.rawPath,
    });
    await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'parse_failed' });
    return { status: 'failed', stage: 'parsing', message: 'Analyze output parse failed' };
  }

  logger.debug(`[analyze] Paper ${paperId}: parse succeeded`, {
    conceptMappings: validated.conceptMappings.length,
    suggestedConcepts: validated.suggestedConcepts.length,
    warningCount: validated.warnings.length,
    bodyLength: validated.body.length,
  });

  if (validated.warnings.length > 0) {
    logger.warn(`[analyze] Paper ${paperId}: validation warnings`, {
      warnings: validated.warnings,
    });
  }

  // ── Abort check before committing results ──
  if (runner.signal.aborted) {
    await restoreAnalysisStatusAfterCancellation(dbProxy, paperId, previousAnalysisStatus, logger);
    return { status: 'cancelled' };
  }

  // ── Step 10: Result write (transactional) ──
  runner.reportProgress({ currentStage: 'writing' });

  // §3 Fix: Check concept staleness before writing results
  if (validated.conceptMappings.length > 0) {
    const isStale = await checkConceptStaleness(dbProxy, ctx.conceptSnapshotHash);
    if (isStale) {
      reportQualityWarning(
        'concept_stale',
        'Concept framework was modified during batch analysis; mappings may reference outdated concept state',
      );
    }
  }

  // 10a+10d: Concept mappings + status update — atomic transaction
  // ConceptMapping requires camelCase fields + full BilingualEvidence + paperId
  const mappingsForDb = validated.conceptMappings.map((m) => ({
    paperId,
    conceptId: m.concept_id,
    relation: m.relation,
    confidence: m.confidence,
    evidence: {
      en: m.evidence.en,
      original: m.evidence.original,
      originalLang: m.evidence.original_lang,
      chunkId: m.evidence.chunk_id ?? null,
      page: m.evidence.page ?? null,
      annotationId: m.evidence.annotation_id ?? null,
    },
    annotationId: m.evidence.annotation_id ?? null,
    reviewed: false,
    reviewedAt: null,
  }));

  // Preferred: single transaction for mappings + status update
  logger.debug(`[analyze] Paper ${paperId}: writing ${mappingsForDb.length} concept mappings`);
  try {
    await dbProxy.completeAnalysis(paperId, mappingsForDb, 'completed');
  } catch (err) {
    logger.warn(`Paper ${paperId}: atomic completeAnalysis failed, falling back to batch write`, { error: (err as Error).message });
    // Fallback: batch write (still transactional) + separate status update
    try {
      await dbProxy.mapPaperConceptBatch(mappingsForDb);
    } catch (batchErr) {
      logger.warn(`Paper ${paperId}: batch write also failed, writing individually`, { error: (batchErr as Error).message });
      for (const mapping of mappingsForDb) {
        try { await dbProxy.mapPaperConcept(mapping); } catch (e) { logger.debug(`Fallback mapping write failed for ${mapping.conceptId}`, { error: (e as Error).message }); }
      }
    }
    await dbProxy.updatePaper(paperId, { analysisStatus: 'completed' });
  }

  // 10c: Concept suggestions via aggregator (§6.8) — outside transaction (non-critical)
  if (ctx.autoSuggestConcepts) {
    await writeSuggestions(validated.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger, ctx.autoSuggestThreshold);
  }

  writeAnalysisArtifact(
    {
      version: 2,
      paperId,
      stage: route.workflowId ?? 'analyze.full',
      mode: 'full',
      businessStatus: 'completed',
      model: result.model,
      summary: extractArtifactSummary(validated.summary, validated.body),
      body: validated.body,
      warnings: validated.warnings,
      qualityWarnings,
      metrics: {
        conceptMappingCount: validated.conceptMappings.length,
        suggestedConceptCount: validated.suggestedConcepts.length,
        truncated: allocation.truncated || assembled.truncated,
      },
      parse: {
        rawPath: validated.rawPath,
      },
      generatedAt: new Date().toISOString(),
    },
    workspacePath,
    logger,
  );

  // 10b: Analysis report (file write — outside transaction)
  const reportPath = writeReport(paperId, validated.body, workspacePath);
  if (reportPath) {
    try { await dbProxy.updatePaper(paperId, { analysisPath: reportPath }); } catch (err) { logger.debug(`Paper ${paperId}: analysisPath update failed`, { error: (err as Error).message }); }
  }

  // Store reasoning chain if available
  if (result.reasoning) {
    const reasoningPath = path.join(workspacePath, 'analyses', `${paperId}.reasoning.txt`);
    try { fs.writeFileSync(reasoningPath, result.reasoning, 'utf-8'); } catch (err) { logger.debug(`Paper ${paperId}: reasoning write failed`, { error: (err as Error).message }); }
  }

  // Relations are NOT computed per-paper — O(N²) cost with hot concepts.
  // Instead, analyzed paper IDs are collected and relations are computed
  // in a single post-batch pass (see workflow entry function).
  return { status: 'completed' };
  } catch (error) {
    if (isAbortError(error, runner.signal)) {
      await restoreAnalysisStatusAfterCancellation(dbProxy, paperId, previousAnalysisStatus, logger);
      return { status: 'cancelled' };
    }
    throw error;
  }
}

// ─── Helpers ───

async function collectMemos(
  dbProxy: AnalyzeServices['dbProxy'],
  paperId: string,
): Promise<MemoForFormat[]> {
  const memos = await dbProxy.getMemosByEntity('paper', paperId);
  return memos.map((m) => ({
    text: (m['text'] as string) ?? '',
    createdAt: (m['createdAt'] as string) ?? '',
    conceptIds: (m['conceptIds'] as string[]) ?? [],
    paperIds: (m['paperIds'] as string[]) ?? [],
  }));
}

function normalizeAnalysisStatusForResume(status: string | undefined): string {
  if (status === 'failed' || status === 'needs_review' || status === 'completed') {
    return status;
  }
  return 'not_started';
}

async function restoreAnalysisStatusAfterCancellation(
  dbProxy: AnalyzeServices['dbProxy'],
  paperId: string,
  previousAnalysisStatus: string,
  logger: Logger,
): Promise<void> {
  try {
    await dbProxy.updatePaper(paperId, { analysisStatus: previousAnalysisStatus });
  } catch (err) {
    logger.debug(`Paper ${paperId}: failed to restore status after cancellation`, {
      error: (err as Error).message,
      previousAnalysisStatus,
    });
  }
}

function buildTruncationWarning(
  details: Array<{ sourceType: string; originalTokens: number; truncatedTo: number }>,
): string {
  const normalized = new Map<string, { originalTokens: number; truncatedTo: number }>();
  for (const detail of details) {
    const existing = normalized.get(detail.sourceType);
    if (!existing || detail.truncatedTo < existing.truncatedTo) {
      normalized.set(detail.sourceType, {
        originalTokens: detail.originalTokens,
        truncatedTo: detail.truncatedTo,
      });
    }
  }

  const samples = [...normalized.entries()]
    .slice(0, 3)
    .map(([sourceType, entry]) => `${sourceType} ${entry.originalTokens}->${entry.truncatedTo}`);

  if (samples.length === 0) {
    return 'Prompt context was truncated to fit the model context window.';
  }

  return `Prompt context was truncated to fit the model context window: ${samples.join('; ')}`;
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return error.name === 'AbortError'
    || code === 'ABORT_ERR'
    || code === 'ABORTED'
    || /aborted|cancelled|canceled/i.test(error.message);
}

function formatRawAnnotations(raw: Array<Record<string, unknown>>): AnnotationForFormat[] {
  return raw
    .map((a) => {
      const entry: AnnotationForFormat = {};
      const page = a['page'];
      if (typeof page === 'number') entry.page = page;
      entry.annotationType = (a['type'] as string) ?? 'highlight';
      entry.selectedText = (a['selectedText'] as string) ?? '';
      const comment = a['comment'] as string | undefined;
      if (comment) entry.comment = comment;
      const conceptId = (a['conceptId'] as string) || undefined;
      if (conceptId) entry.conceptId = conceptId;
      const conceptName = (a['conceptName'] as string) || undefined;
      if (conceptName) entry.conceptName = conceptName;
      return entry;
    })
    .filter((a) => (a.selectedText?.length ?? 0) > 5 || (a.comment?.length ?? 0) > 0);
}

async function writeSuggestions(
  suggestions: Array<{ term: string; termNormalized: string; frequencyInPaper: number; closestExisting: string | null; reason: string; suggestedDefinition: string | null; suggestedKeywords: string[] | null }>,
  paperId: string,
  dbProxy: AnalyzeServices['dbProxy'],
  pushNotifier: PushNotifier | null,
  logger: Logger,
  threshold: number = 3,
): Promise<void> {
  if (suggestions.length === 0) return;

  logger.debug(`[analyze] Paper ${paperId}: writing ${suggestions.length} concept suggestions`, {
    terms: suggestions.map((s) => s.term),
  });

  // Try aggregator if enhanced DB methods available
  // Note: aggregateSuggestions expects sync DB methods. The dbProxy methods are
  // async wrappers around sync DatabaseService — safe to call with `as any`.
  if (dbProxy.getSuggestedConceptByTerm) {
    try {
      const result = await aggregateSuggestions(suggestions, paperId, dbProxy as any, pushNotifier, threshold);
      logger.debug(`[analyze] Paper ${paperId}: suggestion aggregation done`, {
        new: result.newSuggestions,
        updated: result.updatedSuggestions,
        notifications: result.notificationsSent,
      });
      return;
    } catch (err) {
      logger.debug(`Suggestion aggregator failed for paper ${paperId}, falling back to simple write`, { error: (err as Error).message });
    }
  }

  // Fallback: simple write via addSuggestedConcept
  for (const suggestion of suggestions) {
    try {
      await dbProxy.addSuggestedConcept({
        term: suggestion.term,
        frequencyInPaper: suggestion.frequencyInPaper,
        sourcePaperId: paperId,
        closestExistingConceptId: suggestion.closestExisting,
        reason: suggestion.reason,
        suggestedDefinition: suggestion.suggestedDefinition,
        suggestedKeywords: suggestion.suggestedKeywords,
      });
    } catch (err) {
      logger.warn(`Paper ${paperId}: suggestion write failed for "${suggestion.term}"`, { error: (err as Error).message });
    }
  }
}

function writeReport(paperId: string, body: string, workspacePath: string): string | null {
  const reportPath = path.join(workspacePath, 'analyses', `${paperId}.md`);
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, body, 'utf-8');
    return reportPath;
  } catch {
    return null;
  }
}

function resolveStageModel(
  workflowId: AnalyzeStageWorkflowId | null,
  modelRouterConfig: { frontierModel: string; lowCostModel: string },
): string | null {
  if (workflowId == null) return null;
  if (workflowId === 'analyze.intermediate') return modelRouterConfig.lowCostModel;
  return modelRouterConfig.frontierModel;
}

/**
 * Compute a lightweight fingerprint of the concept set.
 * Used to detect if concepts were modified during a batch analysis run.
 */
function computeConceptHash(concepts: ConceptForSubset[]): string {
  // Sort by ID for determinism, then hash all fields used by subset selection and prompt injection
  const sorted = [...concepts].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted.map((c) =>
    `${c.id}:${c.maturity}:${c.definition}:${c.nameEn}:${c.nameZh}:${(c.searchKeywords ?? []).join(',')}:${c.parentId ?? ''}`,
  ).join('|');
  // Simple djb2 hash — sufficient for staleness detection, not crypto
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Check if concept framework has changed since the snapshot was taken.
 * Returns true if stale (concepts were modified).
 */
async function checkConceptStaleness(
  dbProxy: AnalyzeServices['dbProxy'],
  snapshotHash: string,
): Promise<boolean> {
  try {
    const current = (await dbProxy.getAllConcepts()) as Array<Record<string, unknown>>;
    const currentSubset: ConceptForSubset[] = current
      .filter((c) => !c['deprecated'])
      .map((c) => mapConceptRecord(c));
    return computeConceptHash(currentSubset) !== snapshotHash;
  } catch {
    return false; // If check fails, assume not stale
  }
}

/**
 * Map a raw DB concept record to ConceptForSubset.
 * DAO layer guarantees camelCase via fromRow(); snake_case fallbacks are not needed.
 */
function mapConceptRecord(c: Record<string, unknown>): ConceptForSubset {
  return {
    id: c['id'] as string,
    nameEn: (c['nameEn'] as string) ?? '',
    nameZh: (c['nameZh'] as string) ?? '',
    definition: (c['definition'] as string) ?? '',
    searchKeywords: (c['searchKeywords'] as string[]) ?? [],
    maturity: c['maturity'] as 'tentative' | 'working' | 'established',
    parentId: (c['parentId'] as string) ?? null,
  };
}
