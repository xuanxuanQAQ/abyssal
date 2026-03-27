/**
 * useIncrementalGraph — v1.2 分页加载图数据
 *
 * 初始加载焦点节点的 2-hop 邻域，用户点击扩展时增量加载。
 * 本地缓存已加载的节点/边，避免重复请求。
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAPI } from '../../../core/ipc/bridge';
import type { GraphData, GraphNode, GraphEdge, LayerVisibility } from '../../../../shared-types/models';

interface IncrementalGraphState {
  /** Merged graph data from all loaded neighborhoods */
  graphData: GraphData;
  /** Currently loading a neighborhood */
  isLoading: boolean;
  /** Error from last load */
  error: Error | null;
  /** Load the neighborhood around a node */
  expandNode: (nodeId: string, depth?: number) => Promise<void>;
  /** Set of node IDs that have been expanded */
  expandedNodeIds: Set<string>;
  /** Reset and reload from a new focus node */
  resetFocus: (nodeId: string) => void;
}

export function useIncrementalGraph(
  initialFocusNodeId: string | null,
  layers?: LayerVisibility | undefined,
): IncrementalGraphState {
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const nodesRef = useRef<Map<string, GraphNode>>(new Map());
  const edgesRef = useRef<Map<string, GraphEdge>>(new Map());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initial load for the focus node
  const { data: initialData, isLoading: initialLoading } = useQuery({
    queryKey: ['relations', 'neighborhood', initialFocusNodeId, 2, layers],
    queryFn: () => {
      if (!initialFocusNodeId) return { nodes: [], edges: [] } as GraphData;
      return getAPI().db.relations.getNeighborhood(initialFocusNodeId, 2, layers);
    },
    enabled: initialFocusNodeId !== null,
    staleTime: 5 * 60_000,
  });

  // Merge initial data into cache
  useMemo(() => {
    if (!initialData) return;
    for (const node of initialData.nodes) {
      nodesRef.current.set(node.id, node);
    }
    for (const edge of initialData.edges) {
      const edgeKey = edge.id ?? `${edge.source}-${edge.target}-${edge.type}`;
      edgesRef.current.set(edgeKey, edge);
    }
    if (initialFocusNodeId) {
      setExpandedNodeIds(new Set([initialFocusNodeId]));
    }
  }, [initialData, initialFocusNodeId]);

  const expandNode = useCallback(async (nodeId: string, depth = 1) => {
    if (expandedNodeIds.has(nodeId)) return;

    setIsLoading(true);
    setError(null);
    try {
      const data = await getAPI().db.relations.getNeighborhood(nodeId, depth, layers);
      for (const node of data.nodes) {
        nodesRef.current.set(node.id, node);
      }
      for (const edge of data.edges) {
        const edgeKey = edge.id ?? `${edge.source}-${edge.target}-${edge.type}`;
        edgesRef.current.set(edgeKey, edge);
      }
      setExpandedNodeIds((prev) => new Set(prev).add(nodeId));
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to expand node'));
    } finally {
      setIsLoading(false);
    }
  }, [expandedNodeIds, layers]);

  const resetFocus = useCallback((_nodeId: string) => {
    nodesRef.current.clear();
    edgesRef.current.clear();
    setExpandedNodeIds(new Set());
    setVersion((v) => v + 1);
    // The useQuery will re-fetch with the new focus node
  }, []);

  const graphData = useMemo<GraphData>(() => ({
    nodes: Array.from(nodesRef.current.values()),
    edges: Array.from(edgesRef.current.values()),
  }), [version, initialData]);

  return {
    graphData,
    isLoading: initialLoading || isLoading,
    error,
    expandNode,
    expandedNodeIds,
    resetFocus,
  };
}
