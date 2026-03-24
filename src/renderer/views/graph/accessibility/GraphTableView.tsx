import React, { useMemo } from 'react';
import type Graph from 'graphology';
import { useAppStore } from '../../../core/store';

interface GraphTableViewProps {
  graph: Graph | null;
}

interface NodeRow {
  id: string;
  type: string;
  label: string;
  degree: number;
  neighbors: string[];
}

const containerStyle: React.CSSProperties = {
  maxHeight: '100%',
  overflow: 'auto',
  background: 'var(--bg-surface)',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-primary)',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  position: 'sticky' as const,
  top: 0,
  background: 'var(--bg-surface)',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

const rowStyle: React.CSSProperties = {
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
  color: 'var(--text-muted)',
};

function GraphTableView({ graph }: GraphTableViewProps) {
  const focusGraphNode = useAppStore((s) => s.focusGraphNode);

  const rows = useMemo<NodeRow[]>(() => {
    if (!graph) return [];

    const result: NodeRow[] = [];
    graph.forEachNode((nodeId, attributes) => {
      const neighbors: string[] = [];
      let count = 0;
      graph.forEachNeighbor(nodeId, (neighborId, neighborAttrs) => {
        if (count < 3) {
          neighbors.push((neighborAttrs.label as string) ?? neighborId);
        }
        count++;
      });

      result.push({
        id: nodeId,
        type: (attributes.type as string) ?? 'unknown',
        label: (attributes.label as string) ?? nodeId,
        degree: graph.degree(nodeId),
        neighbors,
      });
    });

    // Sort by degree descending for most connected nodes first
    result.sort((a, b) => b.degree - a.degree);
    return result;
  }, [graph]);

  if (!graph) {
    return <div style={emptyStyle}>No graph data available</div>;
  }

  if (rows.length === 0) {
    return <div style={emptyStyle}>Graph is empty</div>;
  }

  return (
    <div style={containerStyle} role="region" aria-label="Graph table view">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Label</th>
            <th style={thStyle}>Degree</th>
            <th style={thStyle}>Neighbors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              style={rowStyle}
              tabIndex={0}
              role="button"
              aria-label={`Focus on ${row.label}`}
              onClick={() => focusGraphNode(row.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  focusGraphNode(row.id);
                }
              }}
            >
              <td style={tdStyle}>{row.type}</td>
              <td style={tdStyle}>{row.label}</td>
              <td style={tdStyle}>{row.degree}</td>
              <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>
                {row.neighbors.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { GraphTableView };
export type { GraphTableViewProps };
