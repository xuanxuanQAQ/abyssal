/**
 * GraphConceptNodePane — Graph 概念节点上下文（§3.2）
 *
 * ConceptDetailCard → NeighborList
 */

import React from 'react';
import { ConceptDetailCard } from '../cards/ConceptDetailCard';
import { NeighborList } from '../cards/NeighborList';

interface GraphConceptNodePaneProps {
  nodeId: string;
}

export function GraphConceptNodePane({ nodeId }: GraphConceptNodePaneProps) {
  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <ConceptDetailCard conceptId={nodeId} />
      <NeighborList nodeId={nodeId} />
    </div>
  );
}
