/**
 * MappingPane — 映射上下文（§3.2）
 *
 * MappingEvidenceCard → AdjudicationControls → RelatedMappings
 */

import React from 'react';
import { MappingCard } from '../cards/MappingCard';
import { useMappingsForConcept } from '../../../core/ipc/hooks/useMappings';

interface MappingPaneProps {
  mappingId: string;
  paperId: string;
  conceptId: string;
}

export function MappingPane({ mappingId, paperId, conceptId }: MappingPaneProps) {
  const { data: relatedMappings, isLoading, isError } = useMappingsForConcept(conceptId);

  // 从 relatedMappings 中找到当前映射
  const currentMapping = relatedMappings?.find((m) => m.id === mappingId);
  const otherMappings = relatedMappings?.filter((m) => m.id !== mappingId) ?? [];

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {/* 当前映射详情 */}
      {isError && (
        <div style={{ padding: 12, color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
          加载映射数据失败
        </div>
      )}
      {currentMapping ? (
        <MappingCard mapping={currentMapping} paperId={paperId} />
      ) : isLoading ? (
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          加载映射详情…
        </div>
      ) : !isError ? (
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          未找到映射数据
        </div>
      ) : null}

      {/* 相关映射 */}
      {otherMappings.length > 0 && (
        <div>
          <div
            style={{
              padding: '8px 12px',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            同概念其他映射 ({otherMappings.length})
          </div>
          {otherMappings.map((m) => (
            <MappingCard key={m.id} mapping={m} paperId={m.paperId} />
          ))}
        </div>
      )}
    </div>
  );
}
