import { describe, expect, it, vi, beforeEach } from 'vitest';

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

vi.mock('./register', () => ({
  typedHandler: vi.fn((channel: string, _logger: unknown, handler: (...args: any[]) => Promise<any>) => {
    registeredHandlers.set(channel, handler);
  }),
}));

import { registerWorkflowsHandlers } from './workflows-handler';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('registerWorkflowsHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
  });

  it('maps legacy generate workflow to article', async () => {
    const logger = makeLogger();
    const start = vi.fn(() => ({ id: 'task-123' }));
    const ctx = {
      logger,
      orchestrator: { start, cancel: vi.fn() },
      activeWorkflows: new Map(),
    } as any;

    registerWorkflowsHandlers(ctx);

    const startHandler = registeredHandlers.get('pipeline:start');
    expect(startHandler).toBeDefined();

    const taskId = await startHandler!({} as any, 'generate', { sectionId: 'sec-1', operation: 'rewrite' });

    expect(start).toHaveBeenCalledWith('article', {
      sectionId: 'sec-1',
      outlineEntryId: 'sec-1',
      operation: 'rewrite',
    });
    expect(taskId).toBe('task-123');
  });

  it('keeps explicit outlineEntryId when provided', async () => {
    const logger = makeLogger();
    const start = vi.fn(() => ({ id: 'task-124' }));
    const ctx = {
      logger,
      orchestrator: { start, cancel: vi.fn() },
      activeWorkflows: new Map(),
    } as any;

    registerWorkflowsHandlers(ctx);

    const startHandler = registeredHandlers.get('pipeline:start');
    await startHandler!({} as any, 'article', { sectionId: 'legacy-sec', outlineEntryId: 'outline-42' });

    expect(start).toHaveBeenCalledWith('article', {
      sectionId: 'legacy-sec',
      outlineEntryId: 'outline-42',
    });
  });

  it('throws when orchestrator is missing on pipeline:start', async () => {
    const ctx = {
      logger: makeLogger(),
      orchestrator: null,
      activeWorkflows: new Map(),
    } as any;

    registerWorkflowsHandlers(ctx);

    const startHandler = registeredHandlers.get('pipeline:start');
    await expect(startHandler!({} as any, 'article', {})).rejects.toThrow('Orchestrator not initialized');
  });

  it('cancels both orchestrator task and legacy activeWorkflow', async () => {
    const abort = vi.fn();
    const ctx = {
      logger: makeLogger(),
      orchestrator: { start: vi.fn(), cancel: vi.fn() },
      activeWorkflows: new Map([
        ['task-9', { abortController: { abort } }],
      ]),
    } as any;

    registerWorkflowsHandlers(ctx);

    const cancelHandler = registeredHandlers.get('pipeline:cancel');
    await cancelHandler!({} as any, 'task-9');

    expect(ctx.orchestrator.cancel).toHaveBeenCalledWith('task-9');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(ctx.activeWorkflows.has('task-9')).toBe(false);
  });
});
