/**
 * Batch runner — headless workflow execution engine.
 *
 * Slim bootstrap (no GUI): lock → config → logger → DB → modules →
 * frameworkState → execute stages → summary → cleanup.
 *
 * Uses Semaphore for parallel per-paper processing,
 * Mutex for serialized DB writes.
 *
 * See spec: §4 (concurrency), §6 (progress), §7 (error handling)
 */

import * as path from 'node:path';
import { ConsoleLogger, FileLogger, type Logger } from '../core/infra/logger';
import { ConfigLoader } from '../core/infra/config';
import { loadGlobalConfig } from '../core/infra/global-config';
import { isWorkspace, scaffoldWorkspace, getWorkspacePaths } from '../core/workspace';
import { createDatabaseService, type DatabaseService } from '../core/database';
import { createBibliographyService } from '../core/bibliography';
import { createSearchService } from '../core/search';
import { AcquireService } from '../core/acquire';
import { ProcessService } from '../core/process';
import { acquireLock, type LockHandle } from '../electron/lock';
import { deriveFrameworkState, type FrameworkState } from '../core/config/framework-state';
import { validateConfig } from '../core/config/config-validator';
import { createLlmClient, type LlmClient } from '../adapter/llm-client/llm-client';
import { createEmbedFunction } from '../adapter/llm-client/embed-function-factory';
import { RerankerScheduler } from '../adapter/llm-client/reranker';
import { createRagService, type RagService } from '../core/rag';
import { createContextBudgetManager } from '../adapter/context-budget/context-budget-manager';
import { WorkflowRunner, type WorkflowType } from '../adapter/orchestrator/workflow-runner';
import { createDiscoverWorkflow } from '../adapter/orchestrator/workflows/discover';
import { createAcquireWorkflow } from '../adapter/orchestrator/workflows/acquire';
import { createProcessWorkflow } from '../adapter/orchestrator/workflows/process';
import { createAnalyzeWorkflow } from '../adapter/orchestrator/workflows/analyze';
import { createSynthesizeWorkflow } from '../adapter/orchestrator/workflows/synthesize';
import { createBibliographyWorkflow } from '../adapter/orchestrator/workflows/bibliography';
import { DEFAULT_CONCURRENCY } from '../adapter/orchestrator/concurrency-guard';
import { CircuitBreakerTripped } from '../adapter/orchestrator/error-classifier';
import { renderSummary, type BatchSummary } from './progress-renderer';
import type { CliArgs } from './cli-entry';

// ─── Stage execution order (§8.5) ───

const STAGE_ORDER: WorkflowType[] = ['discover', 'acquire', 'process', 'analyze', 'synthesize', 'article', 'bibliography'];

// ─── Main entry ───

export async function batchRun(args: CliArgs): Promise<void> {
  let lockHandle: LockHandle | null = null;
  let dbService: DatabaseService | null = null;

  const workspacePath = path.resolve(args.workspace || process.cwd());

  try {
    // ── 1. Process lock ──
    lockHandle = acquireLock(workspacePath);

    // ── 2. Config ──
    if (!isWorkspace(workspacePath)) scaffoldWorkspace({ rootDir: workspacePath });

    const userDataPath = process.env['APPDATA'] ?? process.env['HOME'] ?? '';
    const globalConfig = loadGlobalConfig(userDataPath);
    const config = args.configPath
      ? ConfigLoader.load(args.configPath)
      : ConfigLoader.loadFromWorkspace(workspacePath, globalConfig);

    // ── 3. Logger (stderr + file, stdout reserved for progress) ──
    const wsPaths = getWorkspacePaths(workspacePath);
    const logLevel = args.verbose ? 'debug' as const : config.logging.level;
    const logger: Logger = logLevel === 'debug'
      ? new ConsoleLogger(logLevel)
      : new FileLogger(wsPaths.logs, logLevel);

    // ── 3.5 Configuration validation (10-level chain) ──
    logger.info('Validating configuration...');
    const validationResult = validateConfig(config, {
      workspaceRoot: workspacePath,
      skipDatabaseChecks: true, // DB not yet open
      logger,
    });

    for (const w of validationResult.warnings) {
      if (w.severity === 'warning') {
        logger.warn(`Config warning: ${w.message}`);
      }
    }

    // ── 4. Database ──
    dbService = createDatabaseService({
      dbPath: path.join(workspacePath, '.abyssal', 'abyssal.db'),
      config,
      logger,
      skipVecExtension: false,
    });

    // ── 5. Core modules ──
    const bibliographyModule = createBibliographyService(config, logger);
    const searchService = createSearchService(config, logger);
    const acquireService = new AcquireService(config, logger);
    const processService = new ProcessService(config);

    const { ConfigProvider } = await import('../core/infra/config-provider');
    const configProvider = new ConfigProvider(config);

    const reranker = new RerankerScheduler(configProvider, logger);
    const embedFn = createEmbedFunction({ configProvider, logger });

    let llmClient: LlmClient | null = null;
    const hasKey = !!(
      config.apiKeys.anthropicApiKey
      || config.apiKeys.openaiApiKey
      || config.apiKeys.geminiApiKey
      || config.apiKeys.deepseekApiKey
    );
    if (hasKey) {
      llmClient = createLlmClient({ configProvider, logger, reranker, embedFn });
    }

    let ragService: RagService | null = null;
    if (embedFn.isAvailable) {
      ragService = createRagService(embedFn, dbService, config, logger);
    }

    const cbm = createContextBudgetManager(logger);

    // ── 5.5. Sync concepts.yaml → DB (ensures DB reflects YAML definitions) ──
    if (validationResult.concepts.length > 0) {
      try {
        const { syncConceptsFromYaml } = await import('../core/config/hot-reload/concept-sync');
        const syncReport = syncConceptsFromYaml(validationResult.concepts, dbService.raw, logger);
        logger.info('Concept sync from YAML', {
          added: syncReport.added.length,
          modified: syncReport.modified.length,
          deprecated: syncReport.deprecated.length,
          unchanged: syncReport.unchanged.length,
        });
      } catch (err) {
        logger.warn('Concept sync from YAML failed', { error: (err as Error).message });
      }
    }

    // ── 6. Framework state (§8.6) ──
    // Derive from DB stats (which now include synced YAML concepts)
    let frameworkState: FrameworkState = validationResult.frameworkState;
    try {
      const stats = dbService.getStats() as { concepts: { total: number; tentative: number; working: number; established: number } };
      const dbState = deriveFrameworkState(stats.concepts);
      // Prefer DB-derived state, but fall back to validation result if DB is empty
      // and validation found concepts (sync may have just added them)
      if (dbState !== 'zero_concepts' || validationResult.concepts.length === 0) {
        frameworkState = dbState;
      }
    } catch { /* use validation result */ }

    if (frameworkState === 'zero_concepts') {
      process.stderr.write('ℹ️  No concepts defined — running in concept discovery mode.\n');
      process.stderr.write('   AI will identify key concepts from the literature.\n');
      process.stderr.write('   After batch analysis, review suggestions in Abyssal GUI.\n\n');
    }

    // ── 7. Build workflow runner + register workflows ──
    const runner = new WorkflowRunner(logger, null);
    const dbProxy = createSyncDbProxyShim(dbService);

    // Register discover (§1)
    runner.registerWorkflow('discover', createDiscoverWorkflow({
      dbProxy: dbProxy as any,
      searchService,
      llmClient,
      logger,
      config: {
        discovery: config.discovery as any,
        project: config.project as any,
      },
      frameworkState,
    }));

    // Register acquire (§2)
    runner.registerWorkflow('acquire', createAcquireWorkflow({
      dbProxy: dbProxy as any,
      acquireService,
      identifierResolver: null,
      sanityChecker: null,
      failureMemory: null,
      acquireConfig: config.acquire,
      logger,
      workspacePath,
    }));

    // Register process (text extraction + chunking + embedding)
    runner.registerWorkflow('process', createProcessWorkflow({
      dbProxy: dbProxy as any,
      processService,
      ragService: ragService as any,
      bibliographyService: bibliographyModule as any,
      logger,
      workspacePath,
      hydrateConfig: { enableLlmExtraction: false, enableApiLookup: false },
      llmCallFn: null,
      lookupService: null,
      enrichService: null,
      hydratePersist: null,
    }));

    // Register analyze (requires LLM)
    if (llmClient) {
      runner.registerWorkflow('analyze', createAnalyzeWorkflow({
        dbProxy: dbProxy as any,
        llmClient,
        contextBudgetManager: cbm,
        logger,
        frameworkState,
        workspacePath,
        outputLanguage: config.language.defaultOutputLanguage,
        analysisConfig: {
          autoSuggestConcepts: config.analysis.autoSuggestConcepts,
          autoSuggestThreshold: config.concepts.autoSuggestThreshold,
        },
        ragService: ragService ? {
          retrieve: async (query: string, options?: { paperId?: string; topK?: number }) => {
            const result = await ragService!.retrieve({
              queryText: query,
              taskType: 'analyze',
              conceptIds: [],
              paperIds: options?.paperId ? [options.paperId as any] : [],
              sectionTypeFilter: null,
              sourceFilter: null,
              budgetMode: 'focused',
              maxTokens: 50_000,
              modelContextWindow: 200_000,
              enableCorrectiveRag: true,
              relatedMemoIds: [],
            });
            return {
              passages: result.chunks.map((c: any) => ({
                text: c.text,
                paperId: c.paperId as string,
                score: c.score,
                chunkId: c.chunkId as string,
              })),
              qualityReport: result.qualityReport,
            };
          },
        } : null,
      }));

      runner.registerWorkflow('synthesize', createSynthesizeWorkflow({
        dbProxy: dbProxy as any,
        llmClient,
        contextBudgetManager: cbm,
        ragService: ragService as any,
        logger,
        workspacePath,
      }));
    }

    // Register bibliography (§3)
    runner.registerWorkflow('bibliography', createBibliographyWorkflow({
      dbProxy: dbProxy as any,
      bibliographyService: bibliographyModule as any,
      logger,
      workspacePath,
    }));

    // ── 8. Execute stages ──
    const stages = args.stage === 'all'
      ? STAGE_ORDER
      : [args.stage as WorkflowType];

    const startTime = Date.now();
    const summaryTotals = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    const failureReasons: Record<string, number> = {};

    const recordFailureReason = (message: string | null | undefined): void => {
      if (!message) return;
      failureReasons[message] = (failureReasons[message] ?? 0) + 1;
    };

    for (const stage of stages) {
      if (!runner.activeWorkflowMap) break;

      // Resolve concurrency: CLI arg → per-stage default (§4.4)
      const concurrency = args.concurrency > 0
        ? args.concurrency
        : DEFAULT_CONCURRENCY[stage] ?? 1;

      process.stderr.write(`\n── Stage: ${stage} (concurrency: ${concurrency}) ──\n`);

      try {
        const state = runner.start(stage, {
          ...(args.paperIds.length > 0 && { paperIds: args.paperIds }),
          ...(args.conceptIds.length > 0 && { conceptIds: args.conceptIds }),
          ...(args.articleId != null && { articleId: args.articleId }),
          concurrency,
          dryRun: args.dryRun,
        });

        const result = await state.completionPromise;

        summaryTotals.total += result.progress.totalItems;
        summaryTotals.completed += result.progress.completedItems;
        summaryTotals.failed += result.progress.failedItems;
        summaryTotals.skipped += result.progress.skippedItems;
        for (const error of result.progress.errors) {
          recordFailureReason(error.message);
        }

        process.stderr.write(`Stage ${stage}: ${result.status} (${result.progress.completedItems}/${result.progress.totalItems})\n`);
      } catch (err) {
        if (err instanceof CircuitBreakerTripped) {
          recordFailureReason(`${err.category}: circuit_breaker`);
          process.stderr.write(`Stage ${stage}: CIRCUIT BREAKER — ${err.consecutiveFailures} consecutive ${err.category} failures\n`);
        } else {
          recordFailureReason((err as Error).message);
          process.stderr.write(`Stage ${stage}: FAILED — ${(err as Error).message}\n`);
        }
      }
    }

    // ── 9. Summary ──
    const costStats = llmClient?.getCostStats();
    const summary: BatchSummary = {
      stageName: args.stage === 'all' ? 'Pipeline' : args.stage,
      total: summaryTotals.total,
      completed: summaryTotals.completed,
      failed: summaryTotals.failed,
      skipped: summaryTotals.skipped,
      durationMs: Date.now() - startTime,
      tokenUsage: costStats
        ? Object.entries(costStats.byModel).map(([model, agg]) => ({
            model,
            inputTokens: agg.inputTokens,
            outputTokens: agg.outputTokens,
            cost: agg.totalCost,
          }))
        : [],
      failureReasons,
      conceptSuggestions: [],
      acquisitionSources: {},
    };

    // Query concept suggestions for summary
    try {
      const suggestions = dbService.getSuggestedConcepts() as unknown as Array<Record<string, unknown>>;
      summary.conceptSuggestions = suggestions
        .filter((s) => (s['status'] === 'pending') && ((s['sourcePaperCount'] ?? s['source_paper_count']) as number) >= 3)
        .map((s) => ({
          term: s['term'] as string,
          paperCount: (s['sourcePaperCount'] ?? s['source_paper_count']) as number,
        }));
    } catch { /* ignore */ }

    process.stdout.write(renderSummary(summary) + '\n');

    // ── 10. Cleanup ──
    try { dbService.walCheckpoint(); } catch { /* ignore */ }
    dbService.close();
    lockHandle.release();

  } catch (err) {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    if (dbService) try { dbService.close(); } catch { /* ignore */ }
    if (lockHandle) lockHandle.release();
    process.exit(1);
  }
}

// ─── Sync DB → Async proxy shim ───
// CLI uses DatabaseService (sync, same-process), but workflow code expects
// async DbProxy interface. This thin shim wraps sync calls in promises.

function createSyncDbProxyShim(db: DatabaseService): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get(_target, prop: string) {
      return async (...args: unknown[]) => {
        const method = (db as unknown as Record<string, (...a: unknown[]) => unknown>)[prop];
        if (typeof method !== 'function') {
          throw new Error(`DatabaseService has no method: ${prop}`);
        }
        return method.apply(db, args);
      };
    },
  });
}
