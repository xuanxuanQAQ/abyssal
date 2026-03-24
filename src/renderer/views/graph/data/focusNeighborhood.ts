import type Graph from 'graphology';

export type FocusDepth = '1-hop' | '2-hop' | 'global';

export interface FocusResult {
  visibleNodes: Set<string>;
  focusNodeId: string;
  depth: number;
}

export function computeFocusNeighborhood(
  graph: Graph,
  focalId: string,
  depth: FocusDepth,
): FocusResult {
  // Global: return all nodes
  if (depth === 'global') {
    return {
      visibleNodes: new Set(graph.nodes()),
      focusNodeId: focalId,
      depth: Infinity,
    };
  }

  const maxDepth = depth === '1-hop' ? 1 : 2;
  const visibleNodes = new Set<string>();
  visibleNodes.add(focalId);

  // BFS using graph.forEachNeighbor (traverses ALL edges including forceHidden per delta-3)
  let frontier = [focalId];

  for (let d = 0; d < maxDepth; d++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      graph.forEachNeighbor(nodeId, (neighbor: string) => {
        if (!visibleNodes.has(neighbor)) {
          visibleNodes.add(neighbor);
          nextFrontier.push(neighbor);
        }
      });
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return {
    visibleNodes,
    focusNodeId: focalId,
    depth: maxDepth,
  };
}

export function applyFocusVisuals(
  graph: Graph,
  focusResult: FocusResult | null,
): void {
  if (focusResult === null) {
    // Global mode: reset all nodes to defaults
    graph.forEachNode((nodeId: string) => {
      const originalSize = graph.getNodeAttribute(nodeId, '_originalSize') as number | undefined;
      if (originalSize !== undefined) {
        graph.setNodeAttribute(nodeId, 'size', originalSize);
        graph.removeNodeAttribute(nodeId, '_originalSize');
      }
      graph.setNodeAttribute(nodeId, 'opacity', 1.0);
      graph.setNodeAttribute(nodeId, 'highlighted', false);
      graph.setNodeAttribute(nodeId, 'forceHidden', false);
    });

    graph.forEachEdge((edgeId: string) => {
      graph.setEdgeAttribute(edgeId, 'forceHidden', false);
    });

    return;
  }

  const { visibleNodes, focusNodeId } = focusResult;

  // Compute distance from focal node for each visible node
  const distances = new Map<string, number>();
  distances.set(focusNodeId, 0);
  let frontier = [focusNodeId];
  let currentDepth = 0;

  while (frontier.length > 0 && currentDepth < focusResult.depth) {
    currentDepth++;
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      graph.forEachNeighbor(nodeId, (neighbor: string) => {
        if (!distances.has(neighbor) && visibleNodes.has(neighbor)) {
          distances.set(neighbor, currentDepth);
          nextFrontier.push(neighbor);
        }
      });
    }
    frontier = nextFrontier;
  }

  // Apply visuals to nodes
  graph.forEachNode((nodeId: string) => {
    const currentSize = graph.getNodeAttribute(nodeId, 'size') as number;

    // Store original size if not already stored
    if (graph.getNodeAttribute(nodeId, '_originalSize') === undefined) {
      graph.setNodeAttribute(nodeId, '_originalSize', currentSize);
    }
    const originalSize = graph.getNodeAttribute(nodeId, '_originalSize') as number;

    if (nodeId === focusNodeId) {
      // Focal node: enlarged, full opacity, highlighted
      graph.setNodeAttribute(nodeId, 'size', originalSize * 1.5);
      graph.setNodeAttribute(nodeId, 'opacity', 1.0);
      graph.setNodeAttribute(nodeId, 'highlighted', true);
      graph.setNodeAttribute(nodeId, 'forceHidden', false);
    } else if (visibleNodes.has(nodeId)) {
      const dist = distances.get(nodeId) ?? 0;
      if (dist <= 1) {
        // 1-hop neighbors: original size, full opacity
        graph.setNodeAttribute(nodeId, 'size', originalSize);
        graph.setNodeAttribute(nodeId, 'opacity', 1.0);
        graph.setNodeAttribute(nodeId, 'highlighted', false);
        graph.setNodeAttribute(nodeId, 'forceHidden', false);
      } else {
        // 2-hop neighbors: reduced size, reduced opacity
        graph.setNodeAttribute(nodeId, 'size', originalSize * 0.8);
        graph.setNodeAttribute(nodeId, 'opacity', 0.7);
        graph.setNodeAttribute(nodeId, 'highlighted', false);
        graph.setNodeAttribute(nodeId, 'forceHidden', false);
      }
    } else {
      // Outside focus: minimal size, very low opacity (kept visible per section 6.1)
      graph.setNodeAttribute(nodeId, 'size', 2);
      graph.setNodeAttribute(nodeId, 'opacity', 0.08);
      graph.setNodeAttribute(nodeId, 'highlighted', false);
      graph.setNodeAttribute(nodeId, 'forceHidden', false);
    }
  });

  // Apply visuals to edges
  graph.forEachEdge((edgeId: string) => {
    const source = graph.source(edgeId);
    const target = graph.target(edgeId);
    const hidden = !visibleNodes.has(source) || !visibleNodes.has(target);
    graph.setEdgeAttribute(edgeId, 'forceHidden', hidden);
  });
}
