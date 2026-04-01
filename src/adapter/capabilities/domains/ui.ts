/**
 * UI Capability — application navigation and display control.
 *
 * Allows the AI to navigate views, select entities, control panels,
 * and trigger global search.
 */

import type { Capability } from '../types';
import type { ViewType } from '../../../shared-types/enums';

const VALID_VIEWS: ViewType[] = ['library', 'reader', 'analysis', 'graph', 'writing', 'notes', 'settings'];

export function createUICapability(): Capability {
  return {
    name: 'ui',
    domain: 'ui',
    description: 'Application UI control — navigate views, select entities, manage panels',
    operations: [
      {
        name: 'navigate',
        description: 'Navigate to a specific view in the application. Optionally focus on a specific entity.',
        params: [
          { name: 'view', type: 'string', description: 'Target view', required: true, enumValues: VALID_VIEWS as string[] },
          { name: 'paperId', type: 'string', description: 'Paper ID to select after navigation' },
          { name: 'conceptId', type: 'string', description: 'Concept ID to select after navigation' },
          { name: 'noteId', type: 'string', description: 'Note ID to select after navigation' },
          { name: 'articleId', type: 'string', description: 'Article ID to select after navigation' },
          { name: 'page', type: 'number', description: 'Page number (for reader view)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const view = params['view'] as ViewType;

          ctx.eventBus.emit({
            type: 'ai:navigate',
            view,
            target: {
              ...(params['paperId'] !== undefined && { paperId: params['paperId'] as string }),
              ...(params['conceptId'] !== undefined && { conceptId: params['conceptId'] as string }),
              ...(params['noteId'] !== undefined && { noteId: params['noteId'] as string }),
              ...(params['articleId'] !== undefined && { articleId: params['articleId'] as string }),
              ...(params['page'] !== undefined && { page: params['page'] as number }),
            },
          });

          const targetDesc = [
            params['paperId'] && `paper=${params['paperId']}`,
            params['conceptId'] && `concept=${params['conceptId']}`,
            params['noteId'] && `note=${params['noteId']}`,
            params['page'] && `page=${params['page']}`,
          ].filter(Boolean).join(', ');

          return {
            success: true,
            summary: `Navigated to ${view}${targetDesc ? ` (${targetDesc})` : ''}`,
            emittedEvents: ['ai:navigate'],
          };
        },
      },
      {
        name: 'focus_entity',
        description: 'Focus on a specific entity in the current view (scroll to, highlight, select).',
        params: [
          { name: 'entityType', type: 'string', description: 'Entity type', required: true, enumValues: ['paper', 'concept', 'note', 'article'] },
          { name: 'entityId', type: 'string', description: 'Entity ID', required: true },
          { name: 'anchor', type: 'object', description: 'Optional scroll-to anchor within the entity' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const anchorVal = params['anchor'] as { page?: number; sectionId?: string; text?: string } | undefined;
          ctx.eventBus.emit({
            type: 'ai:focusEntity',
            entityType: params['entityType'] as 'paper' | 'concept' | 'note' | 'article',
            entityId: params['entityId'] as string,
            ...(anchorVal !== undefined && { anchor: anchorVal }),
          });

          return {
            success: true,
            summary: `Focused on ${params['entityType']} ${params['entityId']}`,
            emittedEvents: ['ai:focusEntity'],
          };
        },
      },
      {
        name: 'notify',
        description: 'Show a notification to the user with an optional action button.',
        params: [
          { name: 'title', type: 'string', description: 'Notification title', required: true },
          { name: 'message', type: 'string', description: 'Notification message', required: true },
          { name: 'level', type: 'string', description: 'Notification level', enumValues: ['info', 'success', 'warning'] },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          ctx.eventBus.emit({
            type: 'ai:notify',
            level: (params['level'] as 'info' | 'success' | 'warning') ?? 'info',
            title: params['title'] as string,
            message: params['message'] as string,
          });

          return {
            success: true,
            summary: `Notification shown: ${params['title']}`,
            emittedEvents: ['ai:notify'],
          };
        },
      },
      {
        name: 'suggest',
        description: 'Show a proactive suggestion to the user with action buttons they can click.',
        params: [
          { name: 'title', type: 'string', description: 'Suggestion title', required: true },
          { name: 'description', type: 'string', description: 'Suggestion description', required: true },
          { name: 'actions', type: 'array', description: 'Action buttons (array of {id, label, primary?})', required: true, itemType: 'object' },
          { name: 'priority', type: 'number', description: 'Priority (0-10, higher = more prominent)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const suggestionId = Math.random().toString(36).slice(2, 10);
          ctx.eventBus.emit({
            type: 'ai:suggest',
            suggestion: {
              id: suggestionId,
              title: params['title'] as string,
              description: params['description'] as string,
              actions: params['actions'] as Array<{ id: string; label: string; primary?: boolean }>,
              priority: (params['priority'] as number) ?? 5,
              dismissAfterMs: 0,
            },
          });

          return {
            success: true,
            data: { suggestionId },
            summary: `Suggestion shown: ${params['title']}`,
            emittedEvents: ['ai:suggest'],
          };
        },
      },
    ],
  };
}
