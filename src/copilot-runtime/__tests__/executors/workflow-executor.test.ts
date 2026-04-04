import { WorkflowExecutor } from '../../executors/workflow-executor';
import type { WorkflowExecutorDeps } from '../../executors/workflow-executor';
import { OperationEventEmitter } from '../../event-emitter';
import { makeOperation, resetSeq } from '../helpers';
import type { ExecutionStep } from '../../types';

function makeStep(workflow = 'discover' as const): ExecutionStep & { kind: 'run_workflow' } {
  return { kind: 'run_workflow', workflow };
}

describe('WorkflowExecutor', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    resetSeq();
  });

  describe('execute — success', () => {
    it('returns success with taskId', async () => {
      const deps: WorkflowExecutorDeps = {
        startWorkflow: vi.fn().mockResolvedValue({ taskId: 'task-1', result: { count: 5 } }),
      };
      const executor = new WorkflowExecutor(deps);
      const result = await executor.execute(
        makeOperation({ id: 'op-1' }),
        makeStep(),
        emitter,
      );

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
      expect(result.result).toEqual({ count: 5 });
    });
  });

  describe('execute — failure', () => {
    it('returns success=false with error message', async () => {
      const deps: WorkflowExecutorDeps = {
        startWorkflow: vi.fn().mockResolvedValue({ taskId: 'task-2', error: 'Pipeline failed' }),
      };
      const executor = new WorkflowExecutor(deps);
      const result = await executor.execute(makeOperation(), makeStep(), emitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pipeline failed');
    });

    it('catches thrown errors and returns gracefully', async () => {
      const deps: WorkflowExecutorDeps = {
        startWorkflow: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const executor = new WorkflowExecutor(deps);
      const result = await executor.execute(makeOperation(), makeStep(), emitter);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('execute — aborted', () => {
    it('returns immediately when already aborted', async () => {
      const deps: WorkflowExecutorDeps = {
        startWorkflow: vi.fn(),
      };
      const executor = new WorkflowExecutor(deps);
      const controller = new AbortController();
      controller.abort();

      const result = await executor.execute(
        makeOperation(),
        makeStep(),
        emitter,
        controller.signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Aborted');
      expect(deps.startWorkflow).not.toHaveBeenCalled();
    });
  });
});
