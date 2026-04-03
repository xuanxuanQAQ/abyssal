/**
 * AppContext — singleton holding all runtime module instances.
 *
 * Assembled during bootstrap (Step 6) and available to every IPC handler.
 * Replaces the old ServiceContainer with a richer dependency graph.
 *
 * See spec: section 3 — AppContext Singleton
 */

import type { BrowserWindow } from 'electron';
import type { Worker } from 'node:worker_threads';

import type { AbyssalConfig } from '../core/types/config';
import type { Logger } from '../core/infra/logger';
import type { ConfigProvider } from '../core/infra/config-provider';
import type { DbProxyInstance } from '../db-process/db-proxy';
import type { BibliographyService } from '../core/bibliography';
import type { SearchService } from '../core/search';
import type { AcquireService } from '../core/acquire';
import type { ProcessService } from '../core/process';
import type { RagService } from '../core/rag';
import type { LockHandle } from './lock';
import type { PushManager } from './ipc/push';
import type { LlmClient } from '../adapter/llm-client/llm-client';
import type { ContextBudgetManager } from '../adapter/context-budget/context-budget-manager';
import type { WorkflowRunner } from '../adapter/orchestrator/workflow-runner';
import type { AgentLoop } from '../adapter/agent-loop/agent-loop';
import type { AdvisoryAgent } from '../adapter/advisory-agent/advisory-agent';
import type { CookieJar } from '../core/infra/cookie-jar';
import type { DlaProxy } from '../core/dla/dla-proxy';
import type { DlaScheduler } from '../core/dla/scheduler';
import type { EventBus } from '../core/event-bus';
import type { ResearchSession } from '../core/session';
import type { CapabilityRegistry } from '../adapter/capabilities';
import type { SessionOrchestrator } from '../adapter/orchestrator/session-orchestrator';

// ─── FrameworkState (re-export from canonical location) ───

import type { FrameworkState } from '../core/config/framework-state';
import { deriveFrameworkState, effectiveMode } from '../core/config/framework-state';
export { type FrameworkState, deriveFrameworkState, effectiveMode };

// ─── WorkflowState (active workflow tracking) ───

export interface WorkflowState {
  id: string;
  type: string;
  startedAt: string;
  abortController: AbortController;
  completionPromise: Promise<void>;
}

// ─── AppStats ───

export interface AppStats {
  paperCount: number;
  conceptCount: number;
  frameworkState: FrameworkState;
  activeWorkflows: number;
  uptimeMs: number;
}

// ─── AppContext ───

export interface AppContext {
  // ── Configuration ──
  /** Reactive config provider — use configProvider.config for latest values. */
  configProvider: ConfigProvider;
  /** Convenience getter — equivalent to configProvider.config. */
  config: AbyssalConfig;
  logger: Logger;

  // ── Core modules ──
  /** DB subprocess proxy — all methods are async */
  dbProxy: DbProxyInstance;
  searchModule: SearchService | null;
  acquireModule: AcquireService | null;
  processModule: ProcessService | null;
  ragModule: RagService | null;
  bibliographyModule: BibliographyService | null;

  // ── Adaptation layer modules ──
  /** LlmClient — multi-backend adapter (Claude/OpenAI/DeepSeek/Gemini/SiliconFlow/vLLM) */
  llmClient: LlmClient | null;
  /** Context Budget Manager — token budget allocation engine */
  contextBudgetManager: ContextBudgetManager | null;
  /** Orchestrator — deterministic workflow runner */
  orchestrator: WorkflowRunner | null;
  /** Agent Loop — conversational AI with tool-use */
  agentLoop: AgentLoop | null;
  /** Advisory Agent — read-only diagnostic guardian */
  advisoryAgent: AdvisoryAgent | null;

  // ── Runtime state ──
  activeWorkflows: Map<string, WorkflowState>;
  mainWindow: BrowserWindow | null;
  frameworkState: FrameworkState;
  workerThread: Worker | null;
  lockHandle: LockHandle | null;
  pushManager: PushManager | null;

  /** §6.3 阶段3: 概念变更后需要重新生成的综述草稿 conceptId 集合 */
  staleDrafts: Set<string>;

  /** CookieJar for institutional access (china-institutional source) */
  cookieJar: CookieJar | null;

  /** Read-only direct DB connection for RagService (sync access). Closed on shutdown. */
  ragDbService: import('../core/database').DatabaseService | null;

  /** DLA (Document Layout Analysis) subsystem */
  dlaProxy: DlaProxy | null;
  dlaScheduler: DlaScheduler | null;

  /** AI-centric workbench layers */
  eventBus: EventBus | null;
  session: ResearchSession | null;
  capabilityRegistry: CapabilityRegistry | null;
  sessionOrchestrator: SessionOrchestrator | null;

  // ── Lifecycle flags ──
  isShuttingDown: boolean;
  startedAt: number; // Date.now() at startup

  // ── Workspace ──
  workspaceRoot: string;

  // ── Methods ──
  refreshFrameworkState(): Promise<void>;
  getStats(): Promise<AppStats>;
}

// ─── Factory ───

export interface CreateAppContextOpts {
  configProvider: ConfigProvider;
  logger: Logger;
  dbProxy: DbProxyInstance;
  lockHandle: LockHandle;
  workspaceRoot: string;
  searchModule?: SearchService | null;
  acquireModule?: AcquireService | null;
  processModule?: ProcessService | null;
  ragModule?: RagService | null;
  bibliographyModule?: BibliographyService | null;
}

/**
 * Create a fresh AppContext instance.
 *
 * Upper-layer adapters (llmClient, orchestrator, agentLoop, advisoryAgent)
 * are injected as null — to be implemented when those modules exist.
 */
export function createAppContext(opts: CreateAppContextOpts): AppContext {
  const ctx: AppContext = {
    // Configuration — config getter delegates to configProvider for always-fresh reads
    configProvider: opts.configProvider,
    get config() { return this.configProvider.config; },
    logger: opts.logger,

    // Core modules
    dbProxy: opts.dbProxy,
    ragDbService: null,
    searchModule: opts.searchModule ?? null,
    acquireModule: opts.acquireModule ?? null,
    processModule: opts.processModule ?? null,
    ragModule: opts.ragModule ?? null,
    bibliographyModule: opts.bibliographyModule ?? null,

    // Adaptation layer — TODO
    llmClient: null,
    contextBudgetManager: null,
    orchestrator: null,
    agentLoop: null,
    advisoryAgent: null,

    // Runtime state
    activeWorkflows: new Map(),
    mainWindow: null,
    frameworkState: 'zero_concepts',
    workerThread: null,
    lockHandle: opts.lockHandle,
    pushManager: null,
    staleDrafts: new Set(),
    cookieJar: null,
    dlaProxy: null,
    dlaScheduler: null,

    // AI-centric workbench layers
    eventBus: null,
    session: null,
    capabilityRegistry: null,
    sessionOrchestrator: null,

    // Lifecycle
    isShuttingDown: false,
    startedAt: Date.now(),

    // Workspace
    workspaceRoot: opts.workspaceRoot,

    // Methods (assigned below)
    refreshFrameworkState: null!,
    getStats: null!,
  };

  // ── refreshFrameworkState ──
  // §4.3: Re-queries concept counts and re-derives FrameworkState.
  // Called after concept mutations (add, update, deprecate, merge, split, adopt).
  // Broadcasts to renderer via pushManager when state changes.
  ctx.refreshFrameworkState = async () => {
    try {
      const oldState = ctx.frameworkState;
      const stats = (await ctx.dbProxy.getStats()) as {
        concepts: { total: number; tentative: number; working: number; established: number };
      };
      const newState = deriveFrameworkState(stats.concepts);

      if (oldState === newState) return; // 无变化——不广播

      ctx.frameworkState = newState;
      ctx.logger.info('Framework state changed', { from: oldState, to: newState });

      // §4.3: 推送到渲染进程
      // TODO — pushManager.send('push:framework-state-changed', payload) 待 PushManager 接口完善后启用
      // if (ctx.pushManager) {
      //   ctx.pushManager.send('push:framework-state-changed', {
      //     oldState, newState, conceptStats: stats.concepts,
      //   });
      // }

      // §4.3: 触发 Advisory Agent 重新评估（异步，不阻塞）
      if (ctx.advisoryAgent) {
        ctx.advisoryAgent.generateSuggestions().catch((err: Error) =>
          ctx.logger.warn('Advisory Agent failed after state change', { error: err.message })
        );
      }
    } catch (err) {
      ctx.logger.warn('Failed to refresh framework state', {
        error: (err as Error).message,
      });
    }
  };

  // ── getStats ──
  ctx.getStats = async () => {
    try {
      const dbStats = (await ctx.dbProxy.getStats()) as {
        papers: { total: number };
        concepts: { total: number };
      };
      return {
        paperCount: dbStats.papers.total,
        conceptCount: dbStats.concepts.total,
        frameworkState: ctx.frameworkState,
        activeWorkflows: ctx.activeWorkflows.size,
        uptimeMs: Date.now() - ctx.startedAt,
      };
    } catch {
      return {
        paperCount: 0,
        conceptCount: 0,
        frameworkState: ctx.frameworkState,
        activeWorkflows: ctx.activeWorkflows.size,
        uptimeMs: Date.now() - ctx.startedAt,
      };
    }
  };

  return ctx;
}
