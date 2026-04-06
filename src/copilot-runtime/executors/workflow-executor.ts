/**
 * WorkflowExecutor — runs deterministic workflows (discover, acquire, analyze, article, etc.).
 *
 * Workflows are no longer top-level AI API entries.
 * They are executor-level capabilities dispatched by the Planner.
 */

import type { WorkflowType } from '../../shared-types/enums';
import type {
  CopilotOperation,
  ExecutionStep,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';

export interface WorkflowExecutorDeps {
  startWorkflow: (workflow: WorkflowType, config: Record<string, unknown>) => Promise<{
    taskId: string;
    result?: unknown;
    error?: string;
  }>;
}

export interface WorkflowExecutorResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export class WorkflowExecutor {
  private deps: WorkflowExecutorDeps;

  constructor(deps: WorkflowExecutorDeps) {
    this.deps = deps;
  }

  async execute(
    operation: CopilotOperation,
    step: ExecutionStep & { kind: 'run_workflow' },
    emitter: OperationEventEmitter,
    signal?: AbortSignal,
  ): Promise<WorkflowExecutorResult> {
    if (signal?.aborted) {
      return { taskId: '', success: false, error: 'Aborted' };
    }

    try {
      // Race the workflow against the abort signal so user cancellation
      // takes effect even if startWorkflow doesn't accept a signal.
      const workflowPromise = this.deps.startWorkflow(step.workflow, step.config ?? {});
      const result = signal
        ? await Promise.race([
            workflowPromise,
            new Promise<never>((_, reject) => {
              if (signal.aborted) reject(new Error('Aborted'));
              const onAbort = () => reject(new Error('Aborted'));
              signal.addEventListener('abort', onAbort, { once: true });
              // Clean up the abort listener once the workflow settles
              // to prevent the rejection handler from firing after resolution.
              workflowPromise.finally(() => signal.removeEventListener('abort', onAbort));
            }),
          ])
        : await workflowPromise;

      return {
        taskId: result.taskId,
        success: !result.error,
        result: result.result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err) {
      if (signal?.aborted) {
        return { taskId: '', success: false, error: 'Aborted' };
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        taskId: '',
        success: false,
        error: errMsg,
      };
    }
  }
}
