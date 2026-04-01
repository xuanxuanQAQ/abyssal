/**
 * GraphView — 顶层 Graph 视图容器（§8.1）
 *
 * 全画布 GraphCanvas + 浮动 LayerControls + GraphSearch。
 * Mod+Shift+T 切换可访问性表格视图。
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Graph from 'graphology';
import { useAppStore } from '../../core/store';
import { GraphCanvas } from './canvas/GraphCanvas';
import { useSigmaInstance } from './canvas/useSigmaInstance';
import { useSigmaEvents } from './canvas/useSigmaEvents';
import { useLayoutWorker } from './layout/useLayoutWorker';
import { useLayerFilter } from './hooks/useLayerFilter';
import { useFocusMode } from './hooks/useFocusMode';
import { useLOD } from './hooks/useLOD';
import { useGraphData } from './hooks/useGraphData';
import { synchronizeGraph } from './data/graphSynchronizer';
import { safeSigmaRefresh } from './canvas/sigmaGuard';
import { LayerControls } from './controls/LayerControls';
import { GraphSearch } from './controls/GraphSearch';
import { NodeContextMenu } from './interactions/NodeContextMenu';
import { EdgeTooltip } from './interactions/EdgeTooltip';
import { useDragNode } from './interactions/useDragNode';
import { GraphTableView } from './accessibility/GraphTableView';
import { useGraphKeyboardNav } from './accessibility/useGraphKeyboardNav';
import type { GraphFilter } from '../../../shared-types/ipc';

export function GraphView() {
  const { t } = useTranslation();
  const focusedGraphNodeId = useAppStore((s) => s.focusedGraphNodeId);
  const focusGraphNode = useAppStore((s) => s.focusGraphNode);
  const layerVisibility = useAppStore((s) => s.layerVisibility);
  const similarityThreshold = useAppStore((s) => s.similarityThreshold);

  const containerRef = useRef<HTMLDivElement>(null);
  const [showTableView, setShowTableView] = useState(false);

  // Graph data from TanStack Query
  const filter: GraphFilter | undefined = useMemo(() => {
    if (!focusedGraphNodeId) return undefined;
    return {
      focusNodeId: focusedGraphNodeId,
    };
  }, [focusedGraphNodeId]);
  const { data: graphData } = useGraphData();

  // Graphology instance (persistent across data updates)
  const graphRef = useRef<Graph | null>(null);
  if (!graphRef.current) {
    graphRef.current = new Graph({ multi: true, type: 'directed', allowSelfLoops: false });
  }
  const graph = graphRef.current;

  // Sync TanStack Query data → Graphology (incremental)
  useEffect(() => {
    if (!graphData) return;
    const syncResult = synchronizeGraph(graph, graphData);
    if (syncResult.addedNodes.length > 0 || syncResult.addedEdges.length > 0) {
      const newNodes = syncResult.addedNodes.map((id) => ({
        id,
        x: graph.getNodeAttribute(id, 'x') as number ?? Math.random() * 100,
        y: graph.getNodeAttribute(id, 'y') as number ?? Math.random() * 100,
        size: graph.getNodeAttribute(id, 'size') as number ?? 5,
      }));
      const newEdges = syncResult.addedEdges.map((edgeId) => ({
        source: graph.source(edgeId),
        target: graph.target(edgeId),
        weight: graph.getEdgeAttribute(edgeId, 'weight') as number ?? 1,
      }));
      layoutControls.addNodes(newNodes, newEdges);
    }
  }, [graph, graphData]);

  // Sigma.js instance
  const sigma = useSigmaInstance(containerRef, graph);

  // Layout worker
  const handlePositionsUpdate = useCallback(
    (positions: Float32Array, _globalSpeed: number) => {
      if (!graph) return;
      const nodes = graph.nodes();
      for (let i = 0; i < nodes.length && i * 2 + 1 < positions.length; i++) {
        const nodeId = nodes[i];
        if (!nodeId) continue;
        graph.setNodeAttribute(nodeId, 'x', positions[i * 2]!);
        graph.setNodeAttribute(nodeId, 'y', positions[i * 2 + 1]!);
      }
      safeSigmaRefresh(sigma);
    },
    [graph, sigma],
  );

  const layoutControls = useLayoutWorker(graph, handlePositionsUpdate);

  // Layer filtering
  useLayerFilter(sigma, graph);

  // Focus mode
  useFocusMode(sigma, graph, layoutControls);

  // LOD
  useLOD(sigma, graph);

  // Keyboard navigation
  useGraphKeyboardNav(sigma, graph, containerRef);

  // Node drag
  const dragState = useDragNode(
    sigma,
    graph,
    (nodeId, x, y) => layoutControls.pinNode(nodeId, x, y),
    (nodeId) => layoutControls.unpinNode(nodeId),
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    nodeType: 'paper' | 'concept';
    position: { x: number; y: number };
  } | null>(null);

  // Edge tooltip state
  const [edgeTooltip, setEdgeTooltip] = useState<{
    edgeId: string;
    data: { layer: string; weight: number; conceptName?: string };
    position: { x: number; y: number };
  } | null>(null);

  // Sigma events
  useSigmaEvents(sigma, graph, {
    onNodeRightClick: (nodeId, position) => {
      const nodeType = graph.getNodeAttribute(nodeId, 'nodeType') as
        | 'paper'
        | 'concept';
      setContextMenu({ nodeId, nodeType, position });
    },
    onEdgeHover: (edgeId, position) => {
      if (!edgeId || !position || !graph) {
        setEdgeTooltip(null);
        return;
      }
      const attrs = graph.getEdgeAttributes(edgeId);
      setEdgeTooltip({
        edgeId,
        data: {
          layer: (attrs['layer'] as string) ?? 'citation',
          weight: (attrs['weight'] as number) ?? 0,
        },
        position,
      });
    },
  });

  // Semantic neighbor visible count
  const semanticNeighborCount = useMemo(() => {
    if (!graph) return 0;
    let count = 0;
    graph.forEachEdge((_edge, attrs) => {
      if (
        attrs['layer'] === 'semanticNeighbor' &&
        !attrs['forceHidden'] &&
        (attrs['weight'] as number) >= similarityThreshold
      ) {
        count++;
      }
    });
    return count;
  }, [graph, graphData, layerVisibility, similarityThreshold]);

  // Mod+Shift+T to toggle table view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        setShowTableView((v) => !v);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Relayout handler
  const handleRelayout = useCallback(() => {
    layoutControls.stop();
    layoutControls.start();
  }, [layoutControls]);

  // Select node from search
  const handleSelectNode = useCallback(
    (nodeId: string) => {
      focusGraphNode(nodeId);
    },
    [focusGraphNode],
  );

  if (showTableView) {
    return (
      <div style={{ height: '100%', position: 'relative' }}>
        <GraphTableView graph={graph} />
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          {t('graph.returnHint')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <GraphCanvas containerRef={containerRef} />

      <LayerControls
        semanticNeighborCount={semanticNeighborCount}
        onRelayout={handleRelayout}
      />

      <GraphSearch graph={graph} onSelectNode={handleSelectNode} />

      <NodeContextMenu
        nodeId={contextMenu?.nodeId ?? null}
        nodeType={contextMenu?.nodeType ?? null}
        position={contextMenu?.position ?? null}
        open={contextMenu !== null}
        onOpenChange={(open) => {
          if (!open) setContextMenu(null);
        }}
        onUnpin={(nodeId) => layoutControls.unpinNode(nodeId)}
        isPinned={contextMenu ? dragState.pinnedNodes.has(contextMenu.nodeId) : false}
      />

      <EdgeTooltip
        edgeId={edgeTooltip?.edgeId ?? null}
        edgeData={edgeTooltip?.data ?? null}
        position={edgeTooltip?.position ?? null}
      />
    </div>
  );
}
