/**
 * GraphPaperNodePane — Graph 论文节点上下文（§3.2）
 *
 * PaperQuickInfo → NeighborList
 */

import React from 'react';
import { PaperQuickInfo } from '../cards/PaperQuickInfo';
import { NeighborList } from '../cards/NeighborList';

interface GraphPaperNodePaneProps {
  nodeId: string;
}

export function GraphPaperNodePane({ nodeId }: GraphPaperNodePaneProps) {
  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <PaperQuickInfo paperId={nodeId} />
      <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <NeighborList nodeId={nodeId} />
      </div>
    </div>
  );
}
