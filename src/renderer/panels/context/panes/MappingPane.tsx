/**
 * MappingPane — 映射上下文（§3.2）
 *
 * MappingEvidenceCard → AdjudicationControls → RelatedMappings
 */

import React from 'react';
import { MappingCard } from '../cards/MappingCard';
import { useMappingsForConcept } from '../../../core/ipc/hooks/useMappings';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const errorStyle: React.CSSProperties = { padding: 12, color: 'var(--danger)', fontSize: 'var(--text-sm)' };
const loadingStyle: React.CSSProperties = { padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' };
const emptyStyle: React.CSSProperties = { padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' };
const relatedHeaderStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  borderTop: '1px solid var(--border-subtle)',
};

interface MappingPaneProps {
  mappingId: string;
  paperId: string;
  conceptId: string;
}

export const MappingPane = React.memo(function MappingPane({ mappingId, paperId, conceptId }: MappingPaneProps) {
  const { data: relatedMappings, isLoading, isError } = useMappingsForConcept(conceptId);

  // 从 relatedMappings 中找到当前映射
  const currentMapping = relatedMappings?.find((m) => m.id === mappingId);
  const otherMappings = relatedMappings?.filter((m) => m.id !== mappingId) ?? [];

  return (
    <div style={scrollContainerStyle}>
      {/* 当前映射详情 */}
      {isError && (
        <div style={errorStyle}>
          加载映射数据失败
        </div>
      )}
      {currentMapping ? (
        <MappingCard mapping={currentMapping} paperId={paperId} />
      ) : isLoading ? (
        <div style={loadingStyle}>
          加载映射详情…
        </div>
      ) : !isError ? (
        <div style={emptyStyle}>
          未找到映射数据
        </div>
      ) : null}

      {/* 相关映射 */}
      {otherMappings.length > 0 && (
        <div>
          <div style={relatedHeaderStyle}>
            同概念其他映射 ({otherMappings.length})
          </div>
          {otherMappings.map((m) => (
            <MappingCard key={m.id} mapping={m} paperId={m.paperId} />
          ))}
        </div>
      )}
    </div>
  );
});
