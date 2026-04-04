import { describe, expect, it, vi } from 'vitest';
import { createWritingCapability } from './writing';
import type { OperationContext } from '../types';

function makeCtx(overrides?: Partial<OperationContext>): OperationContext {
  const ctx: OperationContext = {
    session: {} as any,
    eventBus: { emit: vi.fn() } as any,
    services: {
      dbProxy: {} as any,
      orchestrator: {
        start: vi.fn(() => ({ id: 'task-1' })),
      },
    } as any,
    ...overrides,
  };
  return ctx;
}

describe('writing capability', () => {
  const capability = createWritingCapability();

  it('run_synthesis starts synthesize workflow and emits started event', async () => {
    const op = capability.operations.find((o) => o.name === 'run_synthesis');
    expect(op).toBeDefined();

    const ctx = makeCtx();
    const result = await op!.execute({ conceptIds: ['c1', 'c2'], concurrency: 4 }, ctx);

    expect(ctx.services.orchestrator!.start).toHaveBeenCalledWith('synthesize', {
      conceptIds: ['c1', 'c2'],
      concurrency: 4,
    });
    expect((ctx.eventBus.emit as any)).toHaveBeenCalledWith({
      type: 'pipeline:started',
      taskId: 'task-1',
      workflow: 'synthesize',
      conceptIds: ['c1', 'c2'],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ taskId: 'task-1' });
  });

  it('run_synthesis uses defaults when params are missing', async () => {
    const op = capability.operations.find((o) => o.name === 'run_synthesis');
    const ctx = makeCtx();

    await op!.execute({}, ctx);

    expect(ctx.services.orchestrator!.start).toHaveBeenCalledWith('synthesize', {
      conceptIds: [],
      concurrency: 2,
    });
  });

  it('run_article returns error when articleId is missing', async () => {
    const op = capability.operations.find((o) => o.name === 'run_article');
    const ctx = makeCtx();

    const result = await op!.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.summary).toBe('articleId is required');
    expect(ctx.services.orchestrator!.start).not.toHaveBeenCalled();
  });

  it('open_article emits navigation event', async () => {
    const op = capability.operations.find((o) => o.name === 'open_article');
    const ctx = makeCtx();

    const result = await op!.execute({ articleId: 'article-42' }, ctx);

    expect((ctx.eventBus.emit as any)).toHaveBeenCalledWith({
      type: 'ai:navigate',
      view: 'writing',
      target: { articleId: 'article-42' },
      reason: 'Opening article in writing view',
    });
    expect(result.success).toBe(true);
  });

  it('returns a graceful error when orchestrator is unavailable', async () => {
    const op = capability.operations.find((o) => o.name === 'run_synthesis');
    const ctx = makeCtx({ services: { dbProxy: {} as any, orchestrator: null } as any });

    const result = await op!.execute({}, ctx);

    expect(result.success).toBe(false);
    expect(result.summary).toBe('Orchestrator not available');
  });
});
