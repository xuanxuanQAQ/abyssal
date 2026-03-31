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
import * as path from 'node:path';

import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { LlmClient } from '../../llm-client/llm-client';
import type { ContextBudgetManager, FrameworkState } from '../../context-budget/context-budget-manager';
import type { Logger } from '../../../core/infra/logger';
import { PaperNotFoundError } from '../../../core/types/errors';

import {
  buildConceptFrameworkSection,
  type ConceptForPrompt,
  type MemoForPrompt,
} from '../prompt-assembler';

import {
  parseAndValidate,
  buildParseDiagnostic,
  type ParseContext,
} from '../../output-parser/output-parser';

import { createPromptAssembler } from '../../prompt-assembler/prompt-assembler';
import { formatAnnotations, type AnnotationForFormat } from '../../prompt-assembler/section-formatter';
import { countTokens } from '../../llm-client/token-counter';

// New modules
import { resolveAnalysisRoute, type PaperFeatures } from './analyze-modes/model-router';
import { runIntermediateAnalysis } from './analyze-modes/intermediate-analysis';
import { runGenericAnalysis } from './analyze-modes/generic-analysis';
import {
  filterConceptSubsetAsync,
  type ConceptForSubset,
  type SubsetSelectorDb,
} from '../../prompt-assembler/concept-subset-selector';
import { resolveMaturityParams, buildMaturityInstructions } from './concept-evolution/maturity-evaluator';
import { aggregateSuggestions, type SuggestionDb, type PushNotifier } from './suggested-concepts/suggestion-aggregator';
import { computeRelationsAfterAnalysis, type RelationComputeDb } from './relations/compute-relations';

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
  logger: Logger;
  frameworkState: FrameworkState | (() => FrameworkState);
  workspacePath: string;
  pushNotifier?: PushNotifier | null;
  modelRouterConfig?: { frontierModel: string; lowCostModel: string };
  outputLanguage?: string | undefined;
}

// ─── Workflow ───

export function createAnalyzeWorkflow(services: AnalyzeServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath } = services;
    const frameworkState = typeof services.frameworkState === 'function'
      ? services.frameworkState()
      : services.frameworkState;

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
          `Found ${staleResult.items.length} papers stuck in in_progress (previous crash?), resetting to pending`,
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
        analysisStatus: ['pending', 'failed'],
        fulltextStatus: ['acquired', 'available'],
        limit: 1000,
      });
      paperIds = result.items.map((p) => p['id'] as string);
    }

    runner.setTotal(paperIds.length);
    if (paperIds.length === 0) return;

    // Load concept framework once (shared across papers)
    // §3 Fix: Snapshot concept version at batch start for staleness detection
    const allConcepts = (await dbProxy.getAllConcepts()) as Array<Record<string, unknown>>;
    const conceptsForSubset: ConceptForSubset[] = allConcepts
      .filter((c) => !c['deprecated'])
      .map((c) => ({
        id: c['id'] as string,
        nameEn: c['nameEn'] as string ?? c['name_en'] as string ?? '',
        nameZh: c['nameZh'] as string ?? c['name_zh'] as string ?? '',
        definition: c['definition'] as string ?? '',
        searchKeywords: (c['searchKeywords'] as string[] ?? c['search_keywords'] as string[]) ?? [],
        maturity: c['maturity'] as 'tentative' | 'working' | 'established',
        parentId: (c['parentId'] as string ?? c['parent_id'] as string) ?? null,
      }));
    // ConceptForPrompt 兼容别名
    const conceptsForPrompt = conceptsForSubset as unknown as ConceptForPrompt[];

    // Concept version fingerprint: detect if concepts changed during batch
    const conceptSnapshotHash = computeConceptHash(conceptsForSubset);

    // Resolve seed types for model routing
    let seedPaperIds = new Set<string>();
    let axiomPaperIds = new Set<string>();
    if (dbProxy.getSeeds) {
      try {
        const seeds = await dbProxy.getSeeds();
        for (const s of seeds) {
          const pid = (s['paperId'] as string ?? s['paper_id'] as string);
          seedPaperIds.add(pid);
          const stype = (s['seedType'] as string ?? s['seed_type'] as string);
          if (stype === 'axiom') axiomPaperIds.add(pid);
        }
      } catch (err) {
        logger.debug('Seed fetch failed, routing without seed info', { error: (err as Error).message });
      }
    }

    // Pre-fetch citation neighbors for all papers (avoid async/sync mismatch)
    const citationCache = new Map<string, string[]>();
    if (dbProxy.getCitationsFrom && dbProxy.getCitationsTo) {
      for (const pid of paperIds) {
        try {
          const from = await dbProxy.getCitationsFrom(pid);
          const to = await dbProxy.getCitationsTo(pid);
          citationCache.set(pid, [...new Set([...from, ...to])]);
        } catch (err) {
          logger.debug(`Citation fetch failed for ${pid}`, { error: (err as Error).message });
        }
      }
    }

    // Pre-fetch annotation counts and mapping counts for all concepts × papers
    // so the sync SubsetSelectorDb can return real values instead of 0.
    const annotationCountCache = new Map<string, number>(); // `${paperId}:${conceptId}` → count
    const mappingCountCache = new Map<string, number>(); // `${conceptId}:${paperIdsHash}` → count

    // Pre-populate annotation count cache for first batch of papers
    if (dbProxy.countAnnotationsForPaperConcept && paperIds.length > 0 && conceptsForSubset.length > 0) {
      const batchSize = Math.min(paperIds.length, 10);
      const conceptSample = conceptsForSubset.slice(0, 20);
      const promises: Array<Promise<void>> = [];
      for (const pid of paperIds.slice(0, batchSize)) {
        for (const c of conceptSample) {
          const cacheKey = `${pid}:${c.id}`;
          promises.push(
            dbProxy.countAnnotationsForPaperConcept(pid, c.id)
              .then((count: number) => { annotationCountCache.set(cacheKey, count); })
              .catch(() => { /* ignore */ }),
          );
        }
      }
      await Promise.all(promises);
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
    const completedPaperIds: string[] = []; // Track for post-batch relation computation
    const ragService = services.ragService ?? null;

    // Worker-pool pattern
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paperIds!.length) {
        if (runner.signal.aborted) break;
        const paperId = paperIds![nextIndex++]!;

        runner.reportProgress({ currentItem: paperId, currentStage: 'checking' });

        try {
          await analyzeSinglePaper(paperId, {
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
            pushNotifier: services.pushNotifier ?? null,
            modelRouterConfig: services.modelRouterConfig,
            force: false,
            outputLanguage: services.outputLanguage,
            conceptSnapshotHash,
          });
          completedPaperIds.push(paperId);
          runner.reportComplete(paperId);
        } catch (error) {
          runner.reportFailed(paperId, 'analyze', error as Error);
          try {
            await dbProxy.updatePaper(paperId, {
              analysisStatus: 'failed',
              failureReason: (error as Error).message.slice(0, 200),
            });
          } catch { /* ignore db error during error handling */ }
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

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
          await dbProxy.updatePaper(pid, { analysisStatus: 'pending' });
          await analyzeSinglePaper(pid, {
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
            pushNotifier: services.pushNotifier ?? null,
            modelRouterConfig: services.modelRouterConfig,
            force: true,
            outputLanguage: services.outputLanguage,
            conceptSnapshotHash,
          });
          completedPaperIds.push(pid);
        } catch (err) {
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
    conceptsForPrompt: ConceptForPrompt[];
    conceptsForSubset: ConceptForSubset[];
    isZeroConcepts: boolean;
    runner: WorkflowRunnerContext;
    subsetDb: SubsetSelectorDb | null;
    embedder: import('../../prompt-assembler/concept-subset-selector').SubsetEmbedder | null;
    ragService: AnalyzeServices['ragService'];
    seedPaperIds: Set<string>;
    axiomPaperIds: Set<string>;
    upgradeQueue: string[];
    pushNotifier: PushNotifier | null;
    modelRouterConfig: { frontierModel: string; lowCostModel: string } | undefined;
    force: boolean;
    outputLanguage?: string | undefined;
    conceptSnapshotHash: string;
  },
): Promise<void> {
  const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath, runner } = ctx;

  // ══ Step 1: Precheck (§6.1) ══
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) throw new PaperNotFoundError({ message: `Paper not found: ${paperId}` });

  const analysisStatus = paper['analysisStatus'] ?? paper['analysis_status'];
  if (analysisStatus === 'completed' && !ctx.force) {
    runner.reportSkipped(paperId);
    return;
  }

  const fulltextStatus = paper['fulltextStatus'] ?? paper['fulltext_status'];
  if (fulltextStatus !== 'acquired' && fulltextStatus !== 'available') {
    logger.warn(`Paper ${paperId}: fulltext not acquired, skipping`);
    runner.reportSkipped(paperId);
    return;
  }

  await dbProxy.updatePaper(paperId, { analysisStatus: 'in_progress' });

  const textPath = path.join(workspacePath, 'texts', `${paperId}.txt`);
  let fullText = '';
  try {
    fullText = fs.readFileSync(textPath, 'utf-8');
  } catch {
    logger.warn(`Paper ${paperId}: fulltext file not found at ${textPath}`);
  }

  const paperTitle = (paper['title'] as string) ?? '';
  const paperType = (paper['paperType'] as string ?? paper['paper_type'] as string) ?? 'unknown';
  const relevance = (paper['relevance'] as string) ?? 'medium';

  // ══ §1.3: Mode dispatch ══
  if (ctx.isZeroConcepts) {
    // ── Generic analysis mode (§5) ──
    runner.reportProgress({ currentStage: 'generic_analysis' });

    const memos = await collectMemos(dbProxy, paperId);
    const rawAnnotations = await dbProxy.getAnnotations(paperId);

    const allocation = contextBudgetManager.allocate({
      taskType: 'analyze',
      model: 'claude-opus-4',
      modelContextWindow: llmClient.getContextWindow('analyze'),
      costPreference: 'balanced',
      sources: [
        { sourceType: 'paper_fulltext' as const, estimatedTokens: countTokens(fullText), priority: 'HIGH' as const, content: fullText },
        { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memos.map((m) => m.text).join('\n')), priority: 'ABSOLUTE' as const, content: null },
      ],
      conceptMaturities: [],
      frameworkState: ctx.frameworkState,
    });

    const genericResult = await runGenericAnalysis(
      paperId, paperTitle, paperType, fullText,
      rawAnnotations as Array<Record<string, unknown>>,
      memos, allocation, llmClient, logger, workspacePath,
      ctx.outputLanguage,
      runner.signal,
    );

    if (!genericResult.success) {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'parse_failed' });
      return;
    }

    // Write suggestions via aggregator
    await writeSuggestions(genericResult.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger);

    // Write report
    const genericReportPath = writeReport(paperId, genericResult.body, workspacePath);
    await dbProxy.updatePaper(paperId, {
      analysisStatus: 'completed',
      ...(genericReportPath && { analysisPath: genericReportPath }),
    });
    return;
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

  const route = resolveAnalysisRoute(features, ctx.modelRouterConfig);

  if (route.mode === 'skip') {
    runner.reportSkipped(paperId);
    await dbProxy.updatePaper(paperId, { analysisStatus: 'completed' });
    return;
  }

  if (route.mode === 'intermediate') {
    // ── Intermediate analysis (§2.2) ──
    runner.reportProgress({ currentStage: 'intermediate_analysis' });

    const intermediateResult = await runIntermediateAnalysis(
      paperId, fullText, paperTitle, llmClient, logger, workspacePath,
      runner.signal,
    );

    if (intermediateResult) {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'intermediate' as any });
      if (intermediateResult.recommendDeepAnalysis) {
        ctx.upgradeQueue.push(paperId);
      }
    } else {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'intermediate_parse_failed' });
    }
    return;
  }

  // ══ Full analysis mode ══
  runner.reportProgress({ currentStage: 'preparing_context' });

  // ── Step 2: Concept framework with async 6D selection (§3) ──
  const paperCtx = { id: paperId, title: paperTitle, abstract: (paper['abstract'] as string) ?? '' };

  const subsetResult = await filterConceptSubsetAsync(
    ctx.conceptsForSubset, paperCtx, ctx.subsetDb, ctx.embedder,
  );
  const conceptSubset = subsetResult.concepts as unknown as ConceptForPrompt[];

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
        runner.reportQualityWarning(
          paperId,
          'rag_degraded',
          `RAG coverage: ${ragQualityReport.coverage}, gaps: ${ragQualityReport.gaps.join('; ')}, passages: ${ragPassages.length}`,
        );
      }
    } catch (err) {
      ragQualityReport = { coverage: 'insufficient', retryCount: 0, gaps: ['RAG retrieval failed entirely'] };
      runner.reportQualityWarning(
        paperId,
        'rag_degraded',
        `RAG retrieval failed: ${(err as Error).message}`,
      );
    }
  }

  // ── Step 5: Annotations ──
  const rawAnnotations = await dbProxy.getAnnotations(paperId);
  const annotationsForFormat = formatRawAnnotations(rawAnnotations as Array<Record<string, unknown>>);
  const annotationText = formatAnnotations(annotationsForFormat);

  // ── Step 6: CBM decision ──
  runner.reportProgress({ currentStage: 'budgeting' });

  const conceptFrameworkText = buildConceptFrameworkSection(conceptSubset);
  const memoText = memosForPrompt.map((m) => m.text).join('\n');
  const conceptMaturities = conceptSubset.map((c) => c.maturity);
  const ragText = ragPassages.map((p) => p.text).join('\n');

  // Resolve maturity-driven parameters (§4)
  const maturityParams = resolveMaturityParams(conceptMaturities);
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
    model: route.model,
    modelContextWindow: llmClient.getContextWindow('analyze'),
    costPreference: 'balanced',
    sources: sources as any,
    conceptMaturities,
    frameworkState: ctx.frameworkState,
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

  // Inject maturity-specific instructions into system prompt
  if (maturityInstructions) {
    assembled.systemPrompt = assembled.systemPrompt + '\n\n' + maturityInstructions;
  }

  // Inject cross-discipline instruction from subset selection
  if (subsetResult.extraInstruction) {
    assembled.systemPrompt = assembled.systemPrompt + '\n\n' + subsetResult.extraInstruction;
  }

  // ── Abort check before expensive LLM call ──
  if (runner.signal.aborted) return;

  // ── Step 8: LLM call ──
  runner.reportProgress({ currentStage: 'analyzing' });

  const result = await llmClient.complete({
    systemPrompt: assembled.systemPrompt,
    messages: [{ role: 'user', content: assembled.userMessage }],
    workflowId: 'analyze',
    signal: runner.signal,
  });

  // ── Step 9: Output parsing with validation ──
  runner.reportProgress({ currentStage: 'parsing' });

  const parseContext: ParseContext = {
    paperId,
    model: result.model,
  };
  // Attach concept lookup for FK-safe diversion of unknown concept_ids
  if (ctx.conceptsForPrompt.length > 0) {
    parseContext.conceptLookup = {
      exists: (cid: string) => ctx.conceptsForPrompt.some((c) => c.id === cid),
    };
  }

  const validated = parseAndValidate(result.text, parseContext, logger);

  if (!validated.success) {
    const rawPath = path.join(workspacePath, 'analyses', `${paperId}.raw.txt`);
    try {
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, result.text, 'utf-8');
    } catch { /* ignore */ }

    const diagnostic = buildParseDiagnostic(result.text);
    logger.warn(`Paper ${paperId}: parse_failed`, diagnostic);
    await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'parse_failed' });
    return;
  }

  if (validated.warnings.length > 0) {
    logger.warn(`Paper ${paperId}: validation warnings`, {
      warnings: validated.warnings, strategy: validated.strategy, repairRules: validated.repairRules,
    });
  }

  // ── Abort check before committing results ──
  if (runner.signal.aborted) return;

  // ── Step 10: Result write (transactional) ──
  runner.reportProgress({ currentStage: 'writing' });

  // §3 Fix: Check concept staleness before writing results
  if (validated.conceptMappings.length > 0) {
    const isStale = await checkConceptStaleness(dbProxy, ctx.conceptSnapshotHash);
    if (isStale) {
      runner.reportQualityWarning(
        paperId,
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
  await writeSuggestions(validated.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger);

  // 10b: Analysis report (file write — outside transaction)
  const reportPath = writeReport(paperId, validated.body, workspacePath);
  if (reportPath) {
    try { await dbProxy.updatePaper(paperId, { analysisPath: reportPath }); } catch { /* non-critical */ }
  }

  // Store reasoning chain if available
  if (result.reasoning) {
    const reasoningPath = path.join(workspacePath, 'analyses', `${paperId}.reasoning.txt`);
    try { fs.writeFileSync(reasoningPath, result.reasoning, 'utf-8'); } catch { /* ignore */ }
  }

  // Relations are NOT computed per-paper — O(N²) cost with hot concepts.
  // Instead, analyzed paper IDs are collected and relations are computed
  // in a single post-batch pass (see workflow entry function).
}

// ─── Helpers ───

async function collectMemos(
  dbProxy: AnalyzeServices['dbProxy'],
  paperId: string,
): Promise<MemoForPrompt[]> {
  const memos = await dbProxy.getMemosByEntity('paper', paperId);
  return memos.map((m) => ({
    text: (m['text'] as string) ?? '',
    createdAt: (m['createdAt'] as string ?? m['created_at'] as string) ?? '',
    conceptIds: (m['conceptIds'] as string[] ?? m['concept_ids'] as string[]) ?? [],
    paperIds: (m['paperIds'] as string[] ?? m['paper_ids'] as string[]) ?? [],
  }));
}

function formatRawAnnotations(raw: Array<Record<string, unknown>>): AnnotationForFormat[] {
  return raw
    .map((a) => {
      const entry: AnnotationForFormat = {};
      const page = a['page'];
      if (typeof page === 'number') entry.page = page;
      entry.annotationType = (a['type'] as string ?? a['annotation_type'] as string) ?? 'highlight';
      entry.selectedText = (a['selectedText'] as string ?? a['selected_text'] as string) ?? '';
      const comment = a['comment'] as string | undefined;
      if (comment) entry.comment = comment;
      const conceptId = (a['conceptId'] as string ?? a['concept_id'] as string) || undefined;
      if (conceptId) entry.conceptId = conceptId;
      const conceptName = (a['conceptName'] as string ?? a['concept_name'] as string) || undefined;
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
): Promise<void> {
  // Try aggregator if enhanced DB methods available
  // Note: aggregateSuggestions expects sync DB methods. The dbProxy methods are
  // async wrappers around sync DatabaseService — safe to call with `as any`.
  if (dbProxy.getSuggestedConceptByTerm) {
    try {
      await aggregateSuggestions(suggestions, paperId, dbProxy as any, pushNotifier);
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
        termNormalized: suggestion.termNormalized,
        frequency: suggestion.frequencyInPaper,
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

/**
 * Compute a lightweight fingerprint of the concept set.
 * Used to detect if concepts were modified during a batch analysis run.
 */
function computeConceptHash(concepts: ConceptForSubset[]): string {
  // Sort by ID for determinism, then hash IDs + definitions
  const sorted = [...concepts].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted.map((c) => `${c.id}:${c.maturity}:${c.definition.length}`).join('|');
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
      .map((c) => ({
        id: c['id'] as string,
        nameEn: c['nameEn'] as string ?? c['name_en'] as string ?? '',
        nameZh: c['nameZh'] as string ?? c['name_zh'] as string ?? '',
        definition: c['definition'] as string ?? '',
        searchKeywords: (c['searchKeywords'] as string[] ?? c['search_keywords'] as string[]) ?? [],
        maturity: c['maturity'] as 'tentative' | 'working' | 'established',
        parentId: (c['parentId'] as string ?? c['parent_id'] as string) ?? null,
      }));
    return computeConceptHash(currentSubset) !== snapshotHash;
  } catch {
    return false; // If check fails, assume not stale
  }
}
