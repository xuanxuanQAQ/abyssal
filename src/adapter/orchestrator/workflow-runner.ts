/**
 * WorkflowRunner — lifecycle management for deterministic workflows.
 *
 * Manages: state machine (§1.1), progress tracking (§1.2),
 * concurrency control (§1.3), idempotent resume (§1.4).
 *
 * See spec: section 1
 */

import type { Logger } from '../../core/infra/logger';
import type { PushManager } from '../../electron/ipc/push';

// ─── Types ───

export type WorkflowType = 'discover' | 'acquire' | 'analyze' | 'synthesize' | 'article' | 'bibliography';
export type WorkflowStatus = 'created' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface WorkflowError {
  itemId: string;
  stage: string;
  message: string;
  code?: string;
  timestamp: string;
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

export interface WorkflowRunnerContext {
  signal: AbortSignal;
  progress: WorkflowProgress;
  reportProgress(update: Partial<Pick<WorkflowProgress, 'currentItem' | 'currentStage'>>): void;
  reportComplete(itemId: string): void;
  reportFailed(itemId: string, stage: string, error: Error): void;
  reportSkipped(itemId: string): void;
  setTotal(total: number): void;
}

// ─── WorkflowRunner ───

export class WorkflowRunner {
  private readonly activeWorkflows = new Map<string, WorkflowState>();
  private readonly workflowFns = new Map<WorkflowType, WorkflowStepFn>();
  private readonly logger: Logger;
  private readonly pushManager: PushManager | null;
  private startTime = 0;

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
   * Start a workflow. Returns the WorkflowState.
   *
   * Rejects if same-type workflow already running or conflict exists.
   */
  start(type: WorkflowType, options: WorkflowOptions = {}): WorkflowState {
    // Same-type mutex
    for (const [, ws] of this.activeWorkflows) {
      if (ws.type === type && ws.status === 'running') {
        throw new Error(`Workflow '${type}' is already running (id: ${ws.id})`);
      }
      if (ws.status === 'running' && hasConflict(ws.type, type)) {
        throw new Error(`Cannot run '${type}' while '${ws.type}' is running (conflict)`);
      }
    }

    const fn = this.workflowFns.get(type);
    if (!fn) throw new Error(`No workflow registered for type '${type}'`);

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
      estimatedRemainingMs: null,
    };

    this.startTime = Date.now();

    const ctx: WorkflowRunnerContext = {
      signal: abortController.signal,
      progress,
      reportProgress: (update) => {
        if (update.currentItem !== undefined) progress.currentItem = update.currentItem;
        if (update.currentStage !== undefined) progress.currentStage = update.currentStage;
        this.estimateRemaining(progress);
        this.pushProgress(id, type, progress);
      },
      reportComplete: (itemId) => {
        progress.completedItems++;
        progress.currentItem = null;
        progress.currentStage = null;
        this.estimateRemaining(progress);
        this.pushProgress(id, type, progress);
        this.logger.debug(`Workflow ${type}: completed ${itemId}`, { workflowId: id });
      },
      reportFailed: (itemId, stage, error) => {
        progress.failedItems++;
        const errorCode = (error as unknown as Record<string, unknown>)['code'] as string | undefined;
        progress.errors.push({
          itemId,
          stage,
          message: error.message,
          ...(errorCode != null && { code: errorCode }),
          timestamp: new Date().toISOString(),
        });
        progress.currentItem = null;
        progress.currentStage = null;
        this.pushProgress(id, type, progress);
        this.logger.warn(`Workflow ${type}: failed ${itemId} at ${stage}`, { error: error.message });
      },
      reportSkipped: (itemId) => {
        progress.skippedItems++;
        this.logger.debug(`Workflow ${type}: skipped ${itemId}`);
      },
      setTotal: (total) => {
        progress.totalItems = total;
      },
    };

    // Create state FIRST and register in map BEFORE starting execution.
    // execute() reads from activeWorkflows.get(id) — it must exist by then.
    const state: WorkflowState = {
      id,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      progress,
      abortController,
      completionPromise: null!, // Set below after execute() is called
      options,
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
    const startMs = Date.now();
    const state = this.activeWorkflows.get(id)!;

    try {
      await fn(options, ctx);

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

  private estimateRemaining(progress: WorkflowProgress): void {
    if (progress.completedItems < 3) {
      progress.estimatedRemainingMs = null;
      return;
    }
    const elapsed = Date.now() - this.startTime;
    const remaining = progress.totalItems - progress.completedItems - progress.failedItems - progress.skippedItems;
    progress.estimatedRemainingMs = Math.round((elapsed / progress.completedItems) * remaining);
  }

  private pushProgress(id: string, type: WorkflowType, progress: WorkflowProgress): void {
    this.pushManager?.pushWorkflowProgress({
      workflowId: id,
      type,
      status: 'running',
      currentStep: progress.currentStage ?? '',
      progress: { current: progress.completedItems, total: progress.totalItems },
    });
  }
}
