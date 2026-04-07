/**
 * Writing Capability — article/review generation pipeline.
 *
 * Spans: trigger synthesis/article workflows, get writing context,
 * manage article outlines and sections.
 */

import type { Capability } from '../types';
import type { WorkflowType } from '../../../shared-types/enums';

const WORKFLOW_SYNTHESIZE: WorkflowType = 'synthesize';
const WORKFLOW_ARTICLE: WorkflowType = 'article';

export function createWritingCapability(): Capability {
  return {
    name: 'writing',
    domain: 'writing',
    description: 'Academic writing — trigger synthesis, manage articles, generate drafts',
    routeFamilies: ['writing_edit', 'workspace_control', 'ui_navigation'],
    operations: [
      {
        name: 'run_synthesis',
        description: 'Trigger the synthesis pipeline to generate concept summaries across analyzed papers.',
        routeFamilies: ['writing_edit', 'workspace_control'],
        params: [
          { name: 'conceptIds', type: 'array', description: 'Concept IDs to synthesize (empty = all)', itemType: 'string' },
          { name: 'concurrency', type: 'number', description: 'Parallel threads (default 2)' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.orchestrator) {
            return { success: false, summary: 'Orchestrator not available' };
          }
          const conceptIds = Array.isArray(params['conceptIds'])
            ? (params['conceptIds'] as string[])
            : [];
          const concurrency = typeof params['concurrency'] === 'number'
            ? (params['concurrency'] as number)
            : 2;

          const task = ctx.services.orchestrator.start(WORKFLOW_SYNTHESIZE, {
            conceptIds,
            concurrency,
          });

          ctx.eventBus.emit({
            type: 'pipeline:started',
            taskId: task.id,
            workflow: WORKFLOW_SYNTHESIZE,
            conceptIds,
          });

          return {
            success: true,
            data: { taskId: task.id },
            summary: `Synthesis pipeline started (task: ${task.id})`,
            emittedEvents: ['pipeline:started'],
          };
        },
      },
      {
        name: 'run_article',
        description: 'Trigger the article generation pipeline to draft sections based on synthesis results.',
        routeFamilies: ['writing_edit', 'workspace_control'],
        params: [
          { name: 'articleId', type: 'string', description: 'Article ID to generate for', required: true },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.orchestrator) {
            return { success: false, summary: 'Orchestrator not available' };
          }
          const articleId = params['articleId'];
          if (typeof articleId !== 'string' || articleId.length === 0) {
            return { success: false, summary: 'articleId is required' };
          }

          const task = ctx.services.orchestrator.start(WORKFLOW_ARTICLE, {
            articleId,
          });

          ctx.eventBus.emit({
            type: 'pipeline:started',
            taskId: task.id,
            workflow: WORKFLOW_ARTICLE,
          });

          return {
            success: true,
            data: { taskId: task.id },
            summary: `Article generation started (task: ${task.id})`,
            emittedEvents: ['pipeline:started'],
          };
        },
      },
      {
        name: 'open_article',
        description: 'Navigate to the writing view and open a specific article.',
        routeFamilies: ['writing_edit', 'ui_navigation'],
        params: [
          { name: 'articleId', type: 'string', description: 'Article ID to open', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          ctx.eventBus.emit({
            type: 'ai:navigate',
            view: 'writing',
            target: { articleId: params['articleId'] as string },
            reason: 'Opening article in writing view',
          });

          return {
            success: true,
            summary: `Opened article ${params['articleId']} in writing view`,
            emittedEvents: ['ai:navigate'],
          };
        },
      },
    ],
  };
}
