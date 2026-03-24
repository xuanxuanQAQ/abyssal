/**
 * NeighborList — Graph 邻居节点列表（§3.2）
 *
 * 在 GraphPaperNodePane / GraphConceptNodePane 中使用。
 * 从 useGraphData 查询中计算邻居节点。
 */

import React, { useMemo } from 'react';
import { FileText, Lightbulb } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { useGraphData } from '../../../core/ipc/hooks/useRelations';

interface NeighborNode {
  id: string;
  label: string;
  type: 'paper' | 'concept';
  edgeType: string;
  weight: number;
}

interface NeighborListProps {
  nodeId: string;
}

/**
 * 从图数据中提取指定节点的邻居
 */
function computeNeighbors(
  nodes: Array<{ id: string; label?: string; type?: string }>,
  edges: Array<{ source: string; target: string; type: string; weight: number }>,
  nodeId: string
): NeighborNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result: NeighborNode[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    let neighborId: string | null = null;
    if (edge.source === nodeId) neighborId = edge.target;
    else if (edge.target === nodeId) neighborId = edge.source;
    if (!neighborId || seen.has(neighborId)) continue;
    seen.add(neighborId);

    const neighbor = nodeMap.get(neighborId);
    result.push({
      id: neighborId,
      label: neighbor?.label ?? neighborId.slice(0, 12) + '…',
      type: (neighbor?.type === 'concept' ? 'concept' : 'paper') as 'paper' | 'concept',
      edgeType: edge.type,
      weight: edge.weight,
    });
  }

  // 按权重降序排列
  result.sort((a, b) => b.weight - a.weight);
  return result;
}

export function NeighborList({ nodeId }: NeighborListProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { data: graphData, isLoading, isError } = useGraphData();

  const neighbors = useMemo(() => {
    if (!graphData) return [];
    return computeNeighbors(graphData.nodes, graphData.edges, nodeId);
  }, [graphData, nodeId]);

  if (isLoading) {
    return (
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          邻居节点
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
          加载图数据…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          邻居节点
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', textAlign: 'center', padding: 8 }}>
          加载图数据失败
        </div>
      </div>
    );
  }

  if (neighbors.length === 0) {
    return (
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          邻居节点
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
          暂无邻居节点
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        邻居节点 ({neighbors.length})
      </div>
      {neighbors.map((n) => (
        <div
          key={n.id}
          onClick={() => {
            if (n.type === 'paper') {
              navigateTo({ type: 'paper', id: n.id, view: 'reader' });
            } else {
              navigateTo({ type: 'concept', id: n.id });
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 0',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
          }}
        >
          {n.type === 'paper' ? (
            <FileText size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          ) : (
            <Lightbulb size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          )}
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-primary)',
            }}
          >
            {n.label}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
            {n.edgeType}
          </span>
        </div>
      ))}
    </div>
  );
}
