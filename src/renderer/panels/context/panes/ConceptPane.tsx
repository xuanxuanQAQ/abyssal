/**
 * ConceptPane — 概念上下文（§3.2）
 *
 * ConceptDetailCard → ConceptMappingList → EvidencePassages
 */

import React from 'react';
import { useMappingsForConcept } from '../../../core/ipc/hooks/useMappings';
import { ConceptDetailCard } from '../cards/ConceptDetailCard';
import { MappingCard } from '../cards/MappingCard';

interface ConceptPaneProps {
  conceptId: string;
}

export function ConceptPane({ conceptId }: ConceptPaneProps) {
  const { data: mappings, isLoading, isError } = useMappingsForConcept(conceptId);

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <ConceptDetailCard conceptId={conceptId} />

      {/* ConceptMappingList + EvidencePassages */}
      <div style={{ padding: '8px 0' }}>
        <div style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          关联映射 {mappings ? `(${mappings.length})` : ''}
        </div>

        {isError && (
          <div style={{ padding: 12, color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>
            加载映射失败
          </div>
        )}

        {isLoading ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            加载映射…
          </div>
        ) : mappings && mappings.length > 0 ? (
          mappings.map((m) => (
            <MappingCard key={m.id} mapping={m} paperId={m.paperId} />
          ))
        ) : !isError ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
            暂无关联映射
          </div>
        ) : null}
      </div>
    </div>
  );
}
