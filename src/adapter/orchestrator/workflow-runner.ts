/**
 * WorkflowRunner — lifecycle management for deterministic workflows.
 *
 * Manages: state machine (§1.1), progress tracking (§1.2),
 * concurrency control (§1.3), idempotent resume (§1.4).
 *
 * See spec: section 1
 */

import type { Logger } from '../../core/infra/logger';
import { AbyssalError } from '../../core/types/errors';
import type { PushManager } from '../../electron/ipc/push';

// ─── Types ───

export type WorkflowType = 'discover' | 'acquire' | 'process' | 'analyze' | 'synthesize' | 'article' | 'bibliography';
export type WorkflowStatus = 'created' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface WorkflowError {
  itemId: string;
  stage: string;
  message: string;
  code?: string;
  timestamp: string;
}

/** 子步骤状态（与 shared-types/ipc SubstepInfo 对齐） */
export interface WorkflowSubstep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  detail?: string;
}

export interface WorkflowProgress {
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  currentItem: string | null;
  currentStage: string | null;
  errors: WorkflowError[];
  estimatedRemainingMs: number | null;
  /** Quality warnings (e.g. RAG degradation) — not failures, but reduced quality */
  qualityWarnings: WorkflowQualityWarning[];
  /** 当前 item 的子步骤列表（如 acquire cascade 各数据源状态） */
  substeps: WorkflowSubstep[];
  /** 人类可读的当前条目标识（如论文标题/概念名称），推送给前端显示 */
  currentItemLabel: string | null;
}

export interface WorkflowQualityWarning {
  itemId: string;
  type: 'rag_degraded' | 'concept_stale' | 'context_truncated';
  message: string;
  timestamp: string;
}

export interface WorkflowOptions {
  paperIds?: string[];
  conceptIds?: string[];
  articleId?: string;
  outlineEntryId?: string;
  concurrency?: number;
  dryRun?: boolean;
  filter?: Record<string, unknown>;
}

export interface WorkflowResult {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  progress: WorkflowProgress;
  durationMs: number;
}

export interface WorkflowState {
  id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  startedAt: string;
  completedAt: string | null;
  progress: WorkflowProgress;
  abortController: AbortController;
  completionPromise: Promise<WorkflowResult>;
  options: WorkflowOptions;
  /** Timestamp (ms) when this workflow started, for ETA estimation. */
  startTimeMs: number;
  /**
   * Shared paper queue for acquire workflows.
   * Allows new paperIds to be enqueued into a running workflow
   * instead of being rejected by the same-type mutex.
   */
  paperQueue?: string[] | undefined;
  /** O(1) membership check for dedup when enqueuing new paperIds. */
  paperQueueSeen?: Set<string> | undefined;
  /** Resolve function to wake up workers waiting for new items. */
  paperQueueNotify?: (() => void) | undefined;
}

// ─── Conflict matrix (§1.3) ───

const CONFLICT_PAIRS: Array<[WorkflowType, WorkflowType]> = [
  ['analyze', 'synthesize'],
  ['synthesize', 'article'],
];

function hasConflict(running: WorkflowType, incoming: WorkflowType): boolean {
  return CONFLICT_PAIRS.some(
    ([a, b]) =>
      (a === running && b === incoming) ||
      (b === running && a === incoming),
  );
}

// ─── Workflow step function type ───

export type WorkflowStepFn = (
  options: WorkflowOptions,
  runner: WorkflowRunnerContext,
) => Promise<void>;

// ─── Middleware (onion model) ───

export type WorkflowMiddleware = (
  type: WorkflowType,
  options: WorkflowOptions,
  ctx: WorkflowRunnerContext,
  next: () => Promise<void>,
) => Promise<void>;

export interface WorkflowRunnerContext {
  signal: AbortSignal;
  progress: WorkflowProgress;
  /** Unique workflow instance ID — use as taskId for stream chunks. */
  workflowId: string;
  reportProgress(update: Partial<Pick<WorkflowProgress, 'currentItem' | 'currentStage' | 'substeps' | 'currentItemLabel'>>): void;
  reportComplete(itemId: string): void;
  reportFailed(itemId: string, stage: string, error: Error): void;
  reportSkipped(itemId: string): void;
  reportQualityWarning(itemId: string, type: WorkflowQualityWarning['type'], message: string): void;
  setTotal(total: number): void;
  /** Structured logger for workflow steps. */
  logger: Logger;
  /** Push a stream chunk to the renderer for live AI output preview. */
  pushStreamChunk(chunk: string, isLast: boolean): void;
  /**
   * For acquire workflows: take the next paperId from the shared queue.
   * Returns null when the queue is empty AND no more items will arrive (workflow is draining).
   * Blocks (via Promise) when the queue is temporarily empty but may receive new items.
   */
  takeFromQueue?(): Promise<string | null>;
}

// ─── WorkflowRunner ───

export class WorkflowRunner {
  private readonly activeWorkflows = new Map<string, WorkflowState>();
  private readonly workflowFns = new Map<WorkflowType, WorkflowStepFn>();
  private readonly middlewares: WorkflowMiddleware[] = [];
  private readonly logger: Logger;
  private readonly pushManager: PushManager | null;

  constructor(logger: Logger, pushManager: PushManager | null) {
    this.logger = logger;
    this.pushManager = pushManager;
  }

  /**
   * Register a workflow implementation function.
   */
  registerWorkflow(type: WorkflowType, fn: WorkflowStepFn): void {
    this.workflowFns.set(type, fn);
  }

  /**
   * Add a middleware that wraps all workflow executions (onion model).
   * Middlewares are called in registration order, innermost = actual workflow.
   */
  use(middleware: WorkflowMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Start a workflow. Returns the WorkflowState.
   *
   * Rejects if same-type workflow already running or conflict exists.
   */
  start(type: WorkflowType, options: WorkflowOptions = {}): WorkflowState {
    this.logger.info(`[WorkflowRunner] start() called`, { type, options, activeCount: this.activeWorkflows.size, pushManagerAvailable: !!this.pushManager });

    // Same-type handling: acquire supports enqueue-merge; others are mutex.
    for (const [, ws] of this.activeWorkflows) {
      if (ws.type === type && ws.status === 'running') {
        // Acquire workflows support live enqueue — merge new paperIds into running workflow
        if (type === 'acquire' && ws.paperQueue && ws.paperQueueSeen && options.paperIds?.length) {
          const newIds = options.paperIds.filter((id) => !ws.paperQueueSeen!.has(id));
          if (newIds.length > 0) {
            for (const id of newIds) ws.paperQueueSeen!.add(id);
            ws.paperQueue.push(...newIds);
            ws.progress.totalItems += newIds.length;
            this.pushProgress(ws.id, ws.type, ws.progress);
            this.logger.info(`[WorkflowRunner] Enqueued ${newIds.length} papers into running acquire workflow ${ws.id}`, { newIds });
            // Wake up any workers waiting for new items
            ws.paperQueueNotify?.();
          } else {
            this.logger.info(`[WorkflowRunner] All paperIds already in queue, skipping`, { paperIds: options.paperIds });
          }
          return ws;
        }

        this.logger.error(`[WorkflowRunner] BLOCKED — same-type workflow already running: ${ws.id}`);
        throw new AbyssalError({ message: `Workflow '${type}' is already running (id: ${ws.id})`, code: 'WORKFLOW_CONFLICT', recoverable: false });
      }
      if (ws.status === 'running' && hasConflict(ws.type, type)) {
        this.logger.error(`[WorkflowRunner] BLOCKED — conflict with running '${ws.type}': ${ws.id}`);
        throw new AbyssalError({ message: `Cannot run '${type}' while '${ws.type}' is running (conflict)`, code: 'WORKFLOW_CONFLICT', recoverable: false });
      }
    }

    const fn = this.workflowFns.get(type);
    if (!fn) {
      this.logger.error(`[WorkflowRunner] No workflow registered for type '${type}'`, undefined, { registeredTypes: Array.from(this.workflowFns.keys()) });
      throw new AbyssalError({ message: `No workflow registered for type '${type}'`, code: 'WORKFLOW_NOT_FOUND', recoverable: false });
    }

    const id = crypto.randomUUID();
    const abortController = new AbortController();
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

    const workflowStartTime = Date.now();

    const ctx: WorkflowRunnerContext = {
      signal: abortController.signal,
      progress,
      workflowId: id,
      logger: this.logger,
      pushStreamChunk: (chunk: string, isLast: boolean) => {
        this.pushManager?.pushStreamChunk(id, chunk, isLast);
      },
      reportProgress: (update) => {
        if (update.currentItem !== undefined) progress.currentItem = update.currentItem;
        if (update.currentStage !== undefined) progress.currentStage = update.currentStage;
        if (update.substeps !== undefined) progress.substeps = update.substeps;
        if (update.currentItemLabel !== undefined) progress.currentItemLabel = update.currentItemLabel;
        this.estimateRemaining(progress, workflowStartTime);
        this.pushProgress(id, type, progress);
      },
      reportComplete: (itemId) => {
        progress.completedItems++;
        progress.currentItem = null;
        progress.currentStage = null;
        progress.substeps = [];
        progress.currentItemLabel = null;
        this.estimateRemaining(progress, workflowStartTime);
        this.pushProgress(id, type, progress);
        this.logger.debug(`Workflow ${type}: completed ${itemId}`, { workflowId: id });
      },
      reportFailed: (itemId, stage, error) => {
        progress.failedItems++;
        const errorCode = (error as Error & { code?: string }).code;
        progress.errors.push({
          itemId,
          stage,
          message: error.message,
          ...(errorCode != null && { code: errorCode }),
          timestamp: new Date().toISOString(),
        });
        progress.currentItem = null;
        progress.currentStage = null;
        progress.substeps = [];
        progress.currentItemLabel = null;
        this.pushProgress(id, type, progress);
        this.logger.warn(`Workflow ${type}: failed ${itemId} at ${stage}`, { error: error.message });
      },
      reportSkipped: (itemId) => {
        progress.skippedItems++;
        this.logger.debug(`Workflow ${type}: skipped ${itemId}`);
      },
      reportQualityWarning: (itemId, warningType, message) => {
        progress.qualityWarnings.push({
          itemId,
          type: warningType,
          message,
          timestamp: new Date().toISOString(),
        });
        this.pushProgress(id, type, progress);
        this.logger.warn(`Workflow ${type}: quality warning for ${itemId}`, { warningType, message });
      },
      setTotal: (total) => {
        progress.totalItems = total;
      },
    };

    // Create state FIRST and register in map BEFORE starting execution.
    // execute() reads from activeWorkflows.get(id) — it must exist by then.
    const paperQueue = type === 'acquire' ? [...(options.paperIds ?? [])] : undefined;
    const paperQueueSeen = type === 'acquire' ? new Set(options.paperIds ?? []) : undefined;
    // Idle drain timer — if no new items arrive within this window after queue empties,
    // workers will drain and the workflow will complete.
    const DRAIN_IDLE_MS = 30_000;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    let draining = false;
    // Waiters: workers blocked on an empty queue
    let queueWaiters: Array<() => void> = [];

    if (type === 'acquire' && paperQueue) {
      ctx.takeFromQueue = async () => {
        while (true) {
          if (abortController.signal.aborted) return null;

          if (paperQueue.length > 0) {
            // Reset drain timer on each take — workflow stays alive while busy
            if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
            draining = false;
            return paperQueue.shift()!;
          }

          // Queue empty — start drain countdown
          if (!draining) {
            draining = true;
            drainTimer = setTimeout(() => {
              // Wake all waiting workers with null (drain signal)
              for (const resolve of queueWaiters) resolve();
              queueWaiters = [];
            }, DRAIN_IDLE_MS);
          }

          // Wait for either new items or drain timeout
          await new Promise<void>((resolve) => { queueWaiters.push(resolve); });

          // After wakeup: if still draining and queue still empty → exit
          if (draining && paperQueue.length === 0) return null;
        }
      };
    }

    const state: WorkflowState = {
      id,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
      startTimeMs: workflowStartTime,
      completedAt: null,
      progress,
      abortController,
      completionPromise: null!, // Set below after execute() is called
      options,
      // Acquire workflows: shared queue + notify function for live enqueue
      ...(paperQueue ? {
        paperQueue,
        paperQueueSeen,
        paperQueueNotify: () => {
          // Cancel drain timer — new work arrived
          if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
          draining = false;
          // Wake all waiting workers
          for (const resolve of queueWaiters) resolve();
          queueWaiters = [];
        },
      } : {}),
    };

    this.activeWorkflows.set(id, state);

    state.completionPromise = this.execute(id, type, fn, options, ctx, abortController, progress);

    this.logger.info(`Workflow started: ${type}`, { workflowId: id });

    return state;
  }

  private async execute(
    id: string,
    type: WorkflowType,
    fn: WorkflowStepFn,
    options: WorkflowOptions,
    ctx: WorkflowRunnerContext,
    abortController: AbortController,
    progress: WorkflowProgress,
  ): Promise<WorkflowResult> {
    this.logger.info(`[WorkflowRunner] execute() starting`, { id, type });
    const startMs = Date.now();
    const state = this.activeWorkflows.get(id)!;
    let fatalError: Error | null = null;

    try {
      // Build middleware chain (onion model): middleware[0] → middleware[1] → ... → fn
      const core = () => fn(options, ctx);
      const chain = this.middlewares.reduceRight<() => Promise<void>>(
        (next, mw) => () => mw(type, options, ctx, next),
        core,
      );
      await chain();

      // Determine final status
      if (abortController.signal.aborted) {
        state.status = 'cancelled';
      } else if (progress.failedItems > 0 && progress.completedItems > 0) {
        state.status = 'partial';
      } else if (progress.failedItems > 0 && progress.completedItems === 0) {
        state.status = 'failed';
      } else {
        state.status = 'completed';
      }
    } catch (error) {
      fatalError = error as Error;
      if (abortController.signal.aborted) {
        state.status = 'cancelled';
      } else {
        state.status = 'failed';
        this.logger.error(`Workflow ${type} fatal error`, error as Error);
      }
    }

    state.completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    this.logger.info(`Workflow finished: ${type} → ${state.status}`, {
      workflowId: id,
      completed: progress.completedItems,
      failed: progress.failedItems,
      skipped: progress.skippedItems,
      durationMs,
    });

    // Build error detail from fatal error or first item-level error
    const errorDetail = fatalError
      ? { code: 'WORKFLOW_FATAL', message: fatalError.message }
      : progress.errors.length > 0
        ? { code: progress.errors[0]!.code ?? 'ITEM_FAILED', message: progress.errors[0]!.message }
        : undefined;

    // Push final status to renderer — preserve partial/failed so UI can show accurate state
    this.pushProgress(id, type, progress, state.status, errorDetail);

    // Remove from active map to prevent unbounded memory growth.
    // Completed workflows are no longer needed for conflict checking.
    this.activeWorkflows.delete(id);

    return {
      id,
      type,
      status: state.status,
      progress,
      durationMs,
    };
  }

  cancel(workflowId: string): boolean {
    const state = this.activeWorkflows.get(workflowId);
    if (!state || state.status !== 'running') return false;
    state.abortController.abort();
    state.status = 'cancelled';
    // Push cancellation event immediately so the UI updates without waiting
    // for the in-flight LLM call or other async work to finish.
    this.pushProgress(workflowId, state.type, state.progress, 'cancelled');
    return true;
  }

  getState(workflowId: string): WorkflowState | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  getActive(): WorkflowState[] {
    return Array.from(this.activeWorkflows.values()).filter((w) => w.status === 'running');
  }

  get activeWorkflowMap(): Map<string, WorkflowState> {
    return this.activeWorkflows;
  }

  private estimateRemaining(progress: WorkflowProgress, startTimeMs: number): void {
    if (progress.completedItems < 3) {
      progress.estimatedRemainingMs = null;
      return;
    }
    const elapsed = Date.now() - startTimeMs;
    const remaining = progress.totalItems - progress.completedItems - progress.failedItems - progress.skippedItems;
    progress.estimatedRemainingMs = Math.round((elapsed / progress.completedItems) * remaining);
  }

  private pushProgress(id: string, type: WorkflowType, progress: WorkflowProgress, status: string = 'running', error?: { code: string; message: string }): void {
    this.pushManager?.pushWorkflowProgress({
      taskId: id,
      workflow: type,
      status,
      currentStep: progress.currentStage ?? '',
      progress: { current: progress.completedItems, total: progress.totalItems },
      ...(error && { error }),
      ...(progress.substeps.length > 0 && { substeps: progress.substeps }),
      ...(progress.estimatedRemainingMs != null && { estimatedRemainingMs: progress.estimatedRemainingMs }),
      ...(progress.currentItemLabel && { currentItemLabel: progress.currentItemLabel }),
    });
  }
}
