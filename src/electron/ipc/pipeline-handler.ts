import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerPipelineHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('pipeline:start', logger, async (_e, workflow, config) => {
    if (!ctx.orchestrator) {
      throw new Error('Orchestrator not initialized');
    }

    const state = ctx.orchestrator.start(workflow as never, config ?? {} as never);
    return state.id;
  });

  typedHandler('pipeline:cancel', logger, async (_e, taskId) => {
    if (!ctx.orchestrator) {
      throw new Error('Orchestrator not initialized');
    }

    return ctx.orchestrator.cancel(taskId);
  });
}