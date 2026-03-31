/**
 * NeighborList — Graph 邻居节点列表（§3.2）
 *
 * 在 GraphPaperNodePane / GraphConceptNodePane 中使用。
 * 从 useGraphData 查询中计算邻居节点。
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

// ── Static styles ──

const containerStyle: React.CSSProperties = {
  padding: '8px 12px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 8,
};

const loadingTextStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  textAlign: 'center',
  padding: 8,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--danger)',
  textAlign: 'center',
  padding: 8,
};

const neighborRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 0',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
};

const iconStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--text-primary)',
};

const edgeTypeStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--text-xs)',
  flexShrink: 0,
};

export const NeighborList = React.memo(function NeighborList({ nodeId }: NeighborListProps) {
  const { t } = useTranslation();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { data: graphData, isLoading, isError } = useGraphData();

  const neighbors = useMemo(() => {
    if (!graphData) return [];
    return computeNeighbors(graphData.nodes, graphData.edges, nodeId);
  }, [graphData, nodeId]);

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={sectionTitleStyle}>
          {t('context.neighbors.title')}
        </div>
        <div style={loadingTextStyle}>
          {t('context.neighbors.loading')}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={containerStyle}>
        <div style={sectionTitleStyle}>
          {t('context.neighbors.title')}
        </div>
        <div style={errorTextStyle}>
          {t('context.neighbors.loadError')}
        </div>
      </div>
    );
  }

  if (neighbors.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={sectionTitleStyle}>
          {t('context.neighbors.title')}
        </div>
        <div style={loadingTextStyle}>
          {t('context.neighbors.empty')}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={sectionTitleStyle}>
        {t('context.neighbors.titleWithCount', { count: neighbors.length })}
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
          style={neighborRowStyle}
        >
          {n.type === 'paper' ? (
            <FileText size={10} style={iconStyle} />
          ) : (
            <Lightbulb size={10} style={iconStyle} />
          )}
          <span style={labelStyle}>
            {n.label}
          </span>
          <span style={edgeTypeStyle}>
            {n.edgeType}
          </span>
        </div>
      ))}
    </div>
  );
});
