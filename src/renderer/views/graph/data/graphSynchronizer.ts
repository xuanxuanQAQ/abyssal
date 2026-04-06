import type Graph from 'graphology';
import type { GraphData, GraphNode, GraphEdge } from '../../../../shared-types/models';
import { computeNodeSize, computeNodeColor } from './nodeAttributes';
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
    const size = computeNodeSize(node.type, node.citationCount);
    const color = computeNodeColor(node.type, node.relevance, node.level);
    const attrs = {
      label: node.label,
      type: node.type,
      nodeType: node.type,
      relevance: node.relevance,
      citationCount: node.citationCount,
      conceptLevel: node.level,
      entityId: (node.metadata?.entityId as string | undefined) ?? node.id,
      size,
      color,
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
      graph.addEdgeWithKey(edgeId, edge.source, edge.target, {
        layer,
        edgeType: edge.type,
        weight,
        conceptId: edge.conceptId,
        color: computeEdgeColor(layer),
        size: computeEdgeSize(layer, weight),
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
