/**
 * Graph Capability — knowledge graph navigation and analysis.
 *
 * Spans: get relation graph, explore neighborhoods, find connections.
 */

import type { Capability } from '../types';

export function createGraphCapability(): Capability {
  return {
    name: 'graph',
    domain: 'graph',
    description: 'Knowledge graph exploration — navigate relationships between papers and concepts',
    operations: [
      {
        name: 'get_relations',
        description: 'Get the full relation graph or filter by node types, edge types, and similarity threshold.',
        params: [
          { name: 'focusNodeId', type: 'string', description: 'Center node ID' },
          { name: 'depth', type: 'number', description: 'Hop depth (1 or 2)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const graph = await ctx.services.dbProxy.getRelationGraph(params);
          return { success: true, data: graph, summary: 'Retrieved relation graph' };
        },
      },
      {
        name: 'focus_node',
        description: 'Navigate the graph view to center on a specific paper or concept node.',
        params: [
          { name: 'nodeId', type: 'string', description: 'Node ID to focus on', required: true },
          { name: 'entityType', type: 'string', description: 'Entity type', required: true, enumValues: ['paper', 'concept'] },
          { name: 'depth', type: 'number', description: 'Neighborhood depth to show (default 1)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          ctx.eventBus.emit({
            type: 'ai:navigate',
            view: 'graph',
            target: {
              ...(params['entityType'] === 'paper' && { paperId: params['nodeId'] as string }),
              ...(params['entityType'] === 'concept' && { conceptId: params['nodeId'] as string }),
            },
            reason: `Focus on ${params['entityType']} node`,
          });

          ctx.eventBus.emit({
            type: 'ai:focusEntity',
            entityType: params['entityType'] as 'paper' | 'concept',
            entityId: params['nodeId'] as string,
          });

          return {
            success: true,
            summary: `Graph focused on ${params['entityType']} ${params['nodeId']}`,
            emittedEvents: ['ai:navigate', 'ai:focusEntity'],
          };
        },
      },
      {
        name: 'find_path',
        description: 'Find connection paths between two entities in the knowledge graph.',
        params: [
          { name: 'fromId', type: 'string', description: 'Starting entity ID', required: true },
          { name: 'toId', type: 'string', description: 'Target entity ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          // Get neighborhoods of both nodes and find overlap
          const fromGraph = await ctx.services.dbProxy.getRelationGraph({
            focusNodeId: params['fromId'], depth: 2,
          }) as Record<string, unknown>;
          const toGraph = await ctx.services.dbProxy.getRelationGraph({
            focusNodeId: params['toId'], depth: 2,
          }) as Record<string, unknown>;

          const fromNodes = new Set(
            ((fromGraph['nodes'] as Array<{ id: string }>) ?? []).map((n) => n.id),
          );
          const toNodes = ((toGraph['nodes'] as Array<{ id: string }>) ?? []).map((n) => n.id);
          const overlap = toNodes.filter((id) => fromNodes.has(id));

          ctx.session.memory.add({
            type: 'finding',
            content: `Path search ${params['fromId']} → ${params['toId']}: ${overlap.length} shared nodes`,
            source: 'graph.find_path',
            linkedEntities: [params['fromId'] as string, params['toId'] as string],
            importance: 0.5,
          });

          return {
            success: true,
            data: { sharedNodes: overlap, fromNodeCount: fromNodes.size, toNodeCount: toNodes.length },
            summary: `Found ${overlap.length} shared nodes between the two entities`,
          };
        },
      },
      {
        name: 'compare_entities',
        description: 'Show a side-by-side comparison of two or more papers or concepts in the UI.',
        params: [
          { name: 'items', type: 'array', description: 'Entities to compare (array of {entityType, entityId, label})', required: true, itemType: 'object' },
          { name: 'aspect', type: 'string', description: 'What aspect to compare (e.g., "methodology", "findings", "definitions")' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const items = params['items'] as Array<{ entityType: string; entityId: string; label: string }>;
          ctx.eventBus.emit({
            type: 'ai:showComparison',
            items: items.map((i) => ({
              entityType: i.entityType as 'paper' | 'concept',
              entityId: i.entityId,
              label: i.label,
            })),
            aspect: (params['aspect'] as string) ?? 'general',
          });

          return {
            success: true,
            summary: `Showing comparison of ${items.length} entities`,
            emittedEvents: ['ai:showComparison'],
          };
        },
      },
    ],
  };
}
