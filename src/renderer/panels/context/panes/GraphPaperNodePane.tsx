/**
 * GraphPaperNodePane — Graph 论文节点上下文（§3.2）
 *
 * PaperQuickInfo → NeighborList
 */

import React from 'react';
import { PaperQuickInfo } from '../cards/PaperQuickInfo';
import { NeighborList } from '../cards/NeighborList';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const borderTopStyle: React.CSSProperties = { borderTop: '1px solid var(--border-subtle)' };

interface GraphPaperNodePaneProps {
  nodeId: string;
}

export const GraphPaperNodePane = React.memo(function GraphPaperNodePane({ nodeId }: GraphPaperNodePaneProps) {
  return (
    <div style={scrollContainerStyle}>
      <PaperQuickInfo paperId={nodeId} />
      <div style={borderTopStyle}>
        <NeighborList nodeId={nodeId} />
      </div>
    </div>
  );
});
