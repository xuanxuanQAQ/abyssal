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
import { selectConceptSubsetEnhanced, type SubsetSelectorDb } from './concept-evolution/concept-subset-selector';
import { buildMaturityInstructions } from './concept-evolution/maturity-evaluator';
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
    mapPaperConcept: (paperId: unknown, mappings: unknown) => Promise<void>;
    addSuggestedConcept: (suggestion: unknown) => Promise<void>;
    getConcept: (id: unknown) => Promise<Record<string, unknown> | null>;
    getStats: () => Promise<{ concepts: { total: number; tentative: number; working: number; established: number } }>;
    // Enhanced queries for subset selection and relations
    getCitationsFrom?: (paperId: string) => Promise<string[]>;
    getCitationsTo?: (paperId: string) => Promise<string[]>;
    countMappingsForConcept?: (conceptId: string, paperIds: string[]) => Promise<number>;
    computeRelationsForPaper?: (paperId: string, semanticSearchFn: unknown) => Promise<void>;
    getSuggestedConceptByTerm?: (termNormalized: string) => Promise<Record<string, unknown> | null>;
    insertSuggestedConcept?: (data: Record<string, unknown>) => Promise<void>;
    updateSuggestedConcept?: (id: string, updates: Record<string, unknown>) => Promise<void>;
    getSeeds?: () => Promise<Array<Record<string, unknown>>>;
  };
  llmClient: LlmClient;
  contextBudgetManager: ContextBudgetManager;
  logger: Logger;
  frameworkState: FrameworkState;
  workspacePath: string;
  pushNotifier?: PushNotifier | null;
  modelRouterConfig?: { frontierModel: string; lowCostModel: string };
}

// ─── Workflow ───

export function createAnalyzeWorkflow(services: AnalyzeServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath } = services;
    const frameworkState = services.frameworkState;

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
          await dbProxy.updatePaper(p['id'] as string, { analysisStatus: 'pending' });
        }
      }
    } catch { /* ignore stale detection errors */ }

    // Determine papers to analyze
    let paperIds = options.paperIds;
    if (!paperIds || paperIds.length === 0) {
      const result = await dbProxy.queryPapers({
        analysisStatus: ['pending', 'failed'],
        fulltextStatus: ['acquired'],
        limit: 1000,
      });
      paperIds = result.items.map((p) => p['id'] as string);
    }

    runner.setTotal(paperIds.length);
    if (paperIds.length === 0) return;

    // Load concept framework once (shared across papers)
    const allConcepts = (await dbProxy.getAllConcepts()) as Array<Record<string, unknown>>;
    const conceptsForPrompt: ConceptForPrompt[] = allConcepts
      .filter((c) => !c['deprecated'])
      .map((c) => ({
        id: c['id'] as string,
        nameEn: c['nameEn'] as string ?? c['name_en'] as string ?? '',
        nameZh: c['nameZh'] as string ?? c['name_zh'] as string ?? '',
        definition: c['definition'] as string ?? '',
        searchKeywords: (c['searchKeywords'] as string[] ?? c['search_keywords'] as string[]) ?? [],
        maturity: c['maturity'] as 'tentative' | 'working' | 'established',
      }));

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
      } catch { /* ignore */ }
    }

    // Build subset selector DB adapter
    const subsetDb: SubsetSelectorDb | null = (dbProxy.getCitationsFrom && dbProxy.getCitationsTo && dbProxy.countMappingsForConcept)
      ? {
          getCitationNeighbors: (paperId: string): string[] => {
            // TODO: This is async but selector expects sync. For now return empty.
            // Full implementation requires refactoring selector to async or pre-fetching.
            return [];
          },
          countMappingsForConcept: (conceptId: string, paperIds: string[]): number => {
            // TODO: Same async issue. Return 0 for now.
            return 0;
          },
        }
      : null;

    const isZeroConcepts = frameworkState === 'zero_concepts';
    const concurrency = options.concurrency ?? 3;
    const upgradeQueue: string[] = []; // Papers needing upgrade from intermediate → full
    const completedPaperIds: string[] = []; // Track for post-batch relation computation

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
            isZeroConcepts,
            runner,
            subsetDb,
            seedPaperIds,
            axiomPaperIds,
            upgradeQueue,
            pushNotifier: services.pushNotifier ?? null,
            modelRouterConfig: services.modelRouterConfig,
            force: false,
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

    // TODO: Process upgrade queue — papers that intermediate analysis recommended for full
    if (upgradeQueue.length > 0) {
      logger.info(`${upgradeQueue.length} papers recommended for upgrade from intermediate to full analysis`);
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
    isZeroConcepts: boolean;
    runner: WorkflowRunnerContext;
    subsetDb: SubsetSelectorDb | null;
    seedPaperIds: Set<string>;
    axiomPaperIds: Set<string>;
    upgradeQueue: string[];
    pushNotifier: PushNotifier | null;
    modelRouterConfig: { frontierModel: string; lowCostModel: string } | undefined;
    force: boolean;
  },
): Promise<void> {
  const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath, runner } = ctx;

  // ══ Step 1: Precheck (§6.1) ══
  const paper = await dbProxy.getPaper(paperId);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);

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
    );

    if (!genericResult.success) {
      await dbProxy.updatePaper(paperId, { analysisStatus: 'failed', failureReason: 'parse_failed' });
      return;
    }

    // Write suggestions via aggregator
    await writeSuggestions(genericResult.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger);

    // Write report
    writeReport(paperId, genericResult.body, workspacePath);
    await dbProxy.updatePaper(paperId, { analysisStatus: 'completed' });
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

  // ── Step 2: Concept framework with enhanced 3D selection (§3) ──
  const paperCtx = { id: paperId, title: paperTitle, abstract: (paper['abstract'] as string) ?? '' };

  const subsetResult = selectConceptSubsetEnhanced(ctx.conceptsForPrompt, paperCtx, ctx.subsetDb);
  const conceptSubset = subsetResult.concepts as ConceptForPrompt[];

  // ── Step 3: Memo collection ──
  const memosForPrompt = await collectMemos(dbProxy, paperId);

  // ── Step 4: Cross-paper context retrieval ──
  // TODO: wire RagService.retrieve() for cross-paper context
  const ragPassages: [] = [];

  // ── Step 5: Annotations ──
  const rawAnnotations = await dbProxy.getAnnotations(paperId);
  const annotationsForFormat = formatRawAnnotations(rawAnnotations as Array<Record<string, unknown>>);
  const annotationText = formatAnnotations(annotationsForFormat);

  // ── Step 6: CBM decision ──
  runner.reportProgress({ currentStage: 'budgeting' });

  const conceptFrameworkText = buildConceptFrameworkSection(conceptSubset);
  const memoText = memosForPrompt.map((m) => m.text).join('\n');
  const conceptMaturities = conceptSubset.map((c) => c.maturity);

  const allocation = contextBudgetManager.allocate({
    taskType: 'analyze',
    model: route.model,
    modelContextWindow: llmClient.getContextWindow('analyze'),
    costPreference: 'balanced',
    sources: [
      { sourceType: 'paper_fulltext' as const, estimatedTokens: countTokens(fullText), priority: 'HIGH' as const, content: fullText },
      { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memoText), priority: 'ABSOLUTE' as const, content: memoText },
      { sourceType: 'researcher_annotations' as const, estimatedTokens: countTokens(annotationText), priority: 'ABSOLUTE' as const, content: annotationText },
      { sourceType: 'concept_framework' as const, estimatedTokens: countTokens(conceptFrameworkText), priority: 'ABSOLUTE' as const, content: conceptFrameworkText },
    ],
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
    ragPassages,
  });

  // ── Step 8: LLM call ──
  runner.reportProgress({ currentStage: 'analyzing' });

  const result = await llmClient.complete({
    systemPrompt: assembled.systemPrompt,
    messages: [{ role: 'user', content: assembled.userMessage }],
    workflowId: 'analyze',
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

  // ── Step 10: Result write ──
  runner.reportProgress({ currentStage: 'writing' });

  // 10a: Concept mappings
  if (validated.conceptMappings.length > 0) {
    try {
      const mappingsForDb = validated.conceptMappings.map((m) => ({
        concept_id: m.concept_id, relation: m.relation, confidence: m.confidence,
        evidence: m.evidence.en || undefined,
      }));
      await dbProxy.mapPaperConcept(paperId, mappingsForDb);
    } catch (err) {
      logger.warn(`Paper ${paperId}: mapping write failed`, { error: (err as Error).message });
    }
  }

  // 10c: Concept suggestions via aggregator (§6.8)
  await writeSuggestions(validated.suggestedConcepts, paperId, dbProxy, ctx.pushNotifier, logger);

  // 10b: Analysis report
  writeReport(paperId, validated.body, workspacePath);

  // 10d: Status update
  await dbProxy.updatePaper(paperId, { analysisStatus: 'completed' });

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
    } catch { /* fall through to simple write */ }
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

function writeReport(paperId: string, body: string, workspacePath: string): void {
  const reportPath = path.join(workspacePath, 'analyses', `${paperId}.md`);
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, body, 'utf-8');
  } catch { /* ignore */ }
}
