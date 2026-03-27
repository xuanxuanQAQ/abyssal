import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRunner, type WorkflowOptions, type WorkflowRunnerContext } from './workflow-runner';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeRunner() {
  return new WorkflowRunner(logger as any, null);
}

describe('WorkflowRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Lifecycle ───

  it('starts a workflow and returns WorkflowState', () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(1);
      ctx.reportComplete('paper1');
    });

    const state = runner.start('analyze');
    expect(state.id).toBeTruthy();
    expect(state.type).toBe('analyze');
    expect(state.status).toBe('running');
  });

  it('completes successfully when all items processed', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(2);
      ctx.reportComplete('p1');
      ctx.reportComplete('p2');
    });

    const state = runner.start('analyze');
    const result = await state.completionPromise;
    expect(result.status).toBe('completed');
    expect(result.progress.completedItems).toBe(2);
  });

  it('returns partial when some items fail', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(3);
      ctx.reportComplete('p1');
      ctx.reportFailed('p2', 'llm_call', new Error('timeout'));
      ctx.reportComplete('p3');
    });

    const state = runner.start('analyze');
    const result = await state.completionPromise;
    expect(result.status).toBe('partial');
    expect(result.progress.failedItems).toBe(1);
    expect(result.progress.completedItems).toBe(2);
  });

  it('returns failed when all items fail', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(2);
      ctx.reportFailed('p1', 'stage', new Error('err1'));
      ctx.reportFailed('p2', 'stage', new Error('err2'));
    });

    const state = runner.start('analyze');
    const result = await state.completionPromise;
    expect(result.status).toBe('failed');
  });

  // ─── Concurrency control ───

  it('rejects same-type concurrent workflow', async () => {
    const runner = makeRunner();
    let resolve1!: () => void;
    runner.registerWorkflow('analyze', async () => {
      await new Promise<void>((r) => { resolve1 = r; });
    });

    runner.start('analyze');
    expect(() => runner.start('analyze')).toThrow(/already running/);

    resolve1();
  });

  it('rejects conflicting workflow types (analyze vs synthesize)', async () => {
    const runner = makeRunner();
    let resolve1!: () => void;
    runner.registerWorkflow('analyze', async () => {
      await new Promise<void>((r) => { resolve1 = r; });
    });
    runner.registerWorkflow('synthesize', async () => {});

    runner.start('analyze');
    expect(() => runner.start('synthesize')).toThrow(/conflict/);

    resolve1();
  });

  it('allows non-conflicting parallel workflows', async () => {
    const runner = makeRunner();
    let resolve1!: () => void;
    runner.registerWorkflow('analyze', async () => {
      await new Promise<void>((r) => { resolve1 = r; });
    });
    runner.registerWorkflow('acquire', async (_opts, ctx) => {
      ctx.setTotal(0);
    });

    runner.start('analyze');
    // acquire + analyze are not conflicting
    expect(() => runner.start('acquire')).not.toThrow();

    resolve1();
  });

  // ─── Cancellation ───

  it('cancel() aborts running workflow', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      // Wait until aborted
      await new Promise<void>((resolve) => {
        const check = () => {
          if (ctx.signal.aborted) resolve();
          else setTimeout(check, 10);
        };
        check();
      });
    });

    const state = runner.start('analyze');
    const cancelled = runner.cancel(state.id);
    expect(cancelled).toBe(true);

    const result = await state.completionPromise;
    expect(result.status).toBe('cancelled');
  });

  // ─── Memory cleanup ───

  it('removes completed workflows from activeWorkflows map', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('bibliography', async (_opts, ctx) => {
      ctx.setTotal(0);
    });

    const state = runner.start('bibliography');
    await state.completionPromise;

    // Should be cleaned up
    expect(runner.getState(state.id)).toBeUndefined();
    expect(runner.getActive()).toHaveLength(0);
  });

  // ─── Progress estimation ───

  it('estimatedRemainingMs is null when completedItems < 3', async () => {
    const runner = makeRunner();
    runner.registerWorkflow('analyze', async (_opts, ctx) => {
      ctx.setTotal(5);
      ctx.reportComplete('p1');
      expect(ctx.progress.estimatedRemainingMs).toBeNull();
      ctx.reportComplete('p2');
      expect(ctx.progress.estimatedRemainingMs).toBeNull();
    });

    const state = runner.start('analyze');
    await state.completionPromise;
  });
});
