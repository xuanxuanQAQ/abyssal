/**
 * GraphConceptNodePane — Graph 概念节点上下文（§3.2）
 *
 * ConceptDetailCard → NeighborList
 */

import React from 'react';
import { ConceptDetailCard } from '../cards/ConceptDetailCard';
import { NeighborList } from '../cards/NeighborList';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };

interface GraphConceptNodePaneProps {
  nodeId: string;
}

export const GraphConceptNodePane = React.memo(function GraphConceptNodePane({ nodeId }: GraphConceptNodePaneProps) {
  return (
    <div style={scrollContainerStyle}>
      <ConceptDetailCard conceptId={nodeId} />
      <NeighborList nodeId={nodeId} />
    </div>
  );
});
