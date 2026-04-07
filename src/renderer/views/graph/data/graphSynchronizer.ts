import type Graph from 'graphology';
import type { GraphData, GraphNode, GraphEdge } from '../../../../shared-types/models';
import type { Maturity } from '../../../../shared-types/enums';
import { computeNodeSize, computeNodeColor, shouldSkipNode, computeMaturityMeta } from './nodeAttributes';
import { computeEdgeColor, computeEdgeSize, assignCurvatures } from './edgeAttributes';

export interface SyncResult {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
}

function getEdgeId(edge: GraphEdge): string {
  return edge.id ?? `${edge.source}-${edge.target}-${edge.type}`;
}

export function synchronizeGraph(
  graph: Graph,
  newData: GraphData,
): SyncResult {
  const result: SyncResult = {
    addedNodes: [],
    removedNodes: [],
    addedEdges: [],
    removedEdges: [],
  };

  // --- Node synchronization ---
  const currentNodeIds = new Set(graph.nodes());
  const newNodeIds = new Set(newData.nodes.map((n: GraphNode) => n.id));

  // Remove nodes no longer in data (also drops connected edges)
  for (const id of currentNodeIds) {
    if (!newNodeIds.has(id)) {
      graph.dropNode(id);
      result.removedNodes.push(id);
    }
  }

  // Add new nodes and update existing ones
  for (const node of newData.nodes) {
    const maturity = node.metadata?.maturity as Maturity | undefined;
    // Skip tag-maturity concept nodes entirely
    if (shouldSkipNode(node.type, maturity)) {
      if (currentNodeIds.has(node.id)) {
        graph.dropNode(node.id);
        result.removedNodes.push(node.id);
      }
      continue;
    }
    const size = computeNodeSize(node.type, node.citationCount, maturity);
    const color = computeNodeColor(node.type, node.relevance, node.level);
    const maturityMeta = computeMaturityMeta(maturity);
    const attrs = {
      label: node.label,
      type: 'circle',
      nodeType: node.type,
      relevance: node.relevance,
      citationCount: node.citationCount,
      conceptLevel: node.level,
      entityId: (node.metadata?.entityId as string | undefined) ?? node.id,
      size,
      color,
      ...maturityMeta,
      x: (node.metadata?.x as number | undefined) ?? (Math.random() - 0.5) * 100,
      y: (node.metadata?.y as number | undefined) ?? (Math.random() - 0.5) * 100,
    };

    if (!currentNodeIds.has(node.id)) {
      graph.addNode(node.id, attrs);
      result.addedNodes.push(node.id);
    } else {
      // Update existing node attributes if changed
      const existing = graph.getNodeAttributes(node.id);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'x' || key === 'y') {
          // Don't overwrite positions for existing nodes unless explicitly provided
          const metaX = node.metadata?.x as number | undefined;
          const metaY = node.metadata?.y as number | undefined;
          if (metaX !== undefined && key === 'x') {
            graph.setNodeAttribute(node.id, key, value);
          }
          if (metaY !== undefined && key === 'y') {
            graph.setNodeAttribute(node.id, key, value);
          }
        } else if (existing[key] !== value) {
          graph.setNodeAttribute(node.id, key, value);
        }
      }
    }
  }

  // --- Edge synchronization ---
  const currentEdgeIds = new Set(graph.edges());
  const newEdgeMap = new Map<string, GraphEdge>();

  for (const edge of newData.edges) {
    const edgeId = getEdgeId(edge);
    newEdgeMap.set(edgeId, edge);
  }

  const newEdgeIds = new Set(newEdgeMap.keys());

  // Remove edges no longer in data
  for (const id of currentEdgeIds) {
    if (!newEdgeIds.has(id)) {
      graph.dropEdge(id);
      result.removedEdges.push(id);
    }
  }

  // Add new edges
  for (const [edgeId, edge] of newEdgeMap) {
    if (!currentEdgeIds.has(edgeId)) {
      const layer = edge.type;
      const weight = edge.weight ?? 1;
      const isStale = edge.stale === true;
      graph.addEdgeWithKey(edgeId, edge.source, edge.target, {
        layer,
        edgeType: edge.type,
        weight,
        conceptId: edge.conceptId,
        color: isStale ? 'rgba(156, 163, 175, 0.35)' : computeEdgeColor(layer),
        size: isStale ? Math.max(0.5, computeEdgeSize(layer, weight) * 0.5) : computeEdgeSize(layer, weight),
        stale: isStale,
      });
      result.addedEdges.push(edgeId);
    }
  }

  // Assign curvatures for multi-edges
  const edgesForCurvature = graph.edges().map((eid: string) => ({
    source: graph.source(eid),
    target: graph.target(eid),
    id: eid,
  }));
  const curvatures = assignCurvatures(edgesForCurvature);
  for (const [eid, curvature] of curvatures) {
    graph.setEdgeAttribute(eid, 'curvature', curvature);
  }

  return result;
}
