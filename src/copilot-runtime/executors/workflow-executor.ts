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
      const result = await this.deps.startWorkflow(step.workflow, step.config ?? {});

      return {
        taskId: result.taskId,
        success: !result.error,
        result: result.result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        taskId: '',
        success: false,
        error: errMsg,
      };
    }
  }
}
