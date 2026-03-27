/**
 * IPC handler: workflows namespace
 *
 * Contract channels: pipeline:start, pipeline:cancel
 *
 * TODO: Orchestrator not yet implemented. Handlers are stubs that return
 * workflow IDs but do not execute real workflow logic.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';

export function registerWorkflowsHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  typedHandler('pipeline:start', logger, async (_e, workflowType, config?) => {
    // TODO: delegate to orchestrator.startWorkflow(type, config)
    // Returns workflowId -- async execution, progress via push:workflow-progress
    const workflowId = crypto.randomUUID();
    logger.info('Workflow start requested (stub)', { workflowType, workflowId });
    return workflowId;
  });

  typedHandler('pipeline:cancel', logger, async (_e, taskId) => {
    const workflow = ctx.activeWorkflows.get(taskId);
    if (workflow) {
      workflow.abortController.abort();
      ctx.activeWorkflows.delete(taskId);
    }
  });
}
