/**
 * IPC handler: workflows namespace
 *
 * Contract channels: pipeline:start, pipeline:cancel
 *
 * Delegates to WorkflowRunner for actual execution.
 * Progress is pushed via push:workflowProgress.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerWorkflowsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('pipeline:start', logger, async (_e, workflowType, config?) => {
    const orchestrator = ctx.orchestrator;
    if (!orchestrator) throw new Error('Orchestrator not initialized');

    // Resolve deprecated alias
    const resolvedType = workflowType === 'generate' ? 'article' : workflowType;

    // Build WorkflowOptions from the generic config map
    const options = config ? { ...config } : {};
    const state = orchestrator.start(resolvedType as any, options as any);

    logger.info('Workflow started via pipeline:start', { workflowType, workflowId: state.id });
    return state.id;
  });

  typedHandler('pipeline:cancel', logger, async (_e, taskId) => {
    const orchestrator = ctx.orchestrator;
    if (orchestrator) {
      orchestrator.cancel(taskId);
    }

    // Also check legacy activeWorkflows map on AppContext
    const workflow = ctx.activeWorkflows.get(taskId);
    if (workflow) {
      workflow.abortController.abort();
      ctx.activeWorkflows.delete(taskId);
    }
  });
}
