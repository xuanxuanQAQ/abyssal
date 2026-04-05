import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunner } from '../../../src/adapter/orchestrator/workflow-runner';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('WorkflowRunner robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks workflow as failed when workflow function throws', async () => {
    const runner = new WorkflowRunner(logger as any, null);
    runner.registerWorkflow('analyze', async () => {
      throw new Error('runner exploded');
    });

    const state = runner.start('analyze');
    const result = await state.completionPromise;

    expect(result.status).toBe('failed');
    expect(logger.error).toHaveBeenCalledWith(
      'Workflow analyze fatal error',
      expect.objectContaining({ message: 'runner exploded' }),
    );
  });

  it('does not fail a workflow when only quality warnings are reported', async () => {
    const runner = new WorkflowRunner(logger as any, null);
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(1);
      ctx.reportQualityWarning('paper-1', 'rag_degraded', 'partial retrieval');
      ctx.reportComplete('paper-1');
    });

    const state = runner.start('analyze');
    const result = await state.completionPromise;

    expect(result.status).toBe('completed');
    expect(result.progress.qualityWarnings).toHaveLength(1);
    expect(result.progress.failedItems).toBe(0);
  });
});
