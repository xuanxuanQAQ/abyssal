/**
 * MappingSuggestionList — 映射建议列表（§7.4、§8）
 *
 * 排序：pending 在前 → confidence 降序 → challenges 优先
 * 分组：按概念 / 按状态
 * 筛选：全部 / 待裁决 / 高置信 / 冲突
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MappingCard } from './MappingCard';
import { useMappingsForPaper } from '../../../core/ipc/hooks/useMappings';
import type { ConceptMapping } from '../../../../shared-types/models';

type FilterType = 'all' | 'pending' | 'high_confidence' | 'conflict';

interface MappingSuggestionListProps {
  paperId: string;
}

const RELATION_PRIORITY: Record<string, number> = {
  challenges: 3,
  extends: 2,
  supports: 1,
  unmapped: 0,
};

function sortMappings(mappings: ConceptMapping[]): ConceptMapping[] {
  return [...mappings].sort((a, b) => {
    // pending 在前
    if (a.adjudicationStatus === 'pending' && b.adjudicationStatus !== 'pending') return -1;
    if (a.adjudicationStatus !== 'pending' && b.adjudicationStatus === 'pending') return 1;
    // confidence 降序
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // relationType 优先级
    return (RELATION_PRIORITY[b.relationType] ?? 0) - (RELATION_PRIORITY[a.relationType] ?? 0);
  });
}

// ── Static styles ──

const loadingStyle: React.CSSProperties = {
  padding: 12,
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm)',
};

const progressBarContainerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
};

const progressLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const progressTrackStyle: React.CSSProperties = {
  height: 4,
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 2,
  overflow: 'hidden',
};

const allAdjudicatedStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 'var(--text-xs)',
  color: 'var(--success)',
};

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  overflowX: 'auto',
};

const emptyStyle: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--text-sm)',
};

export const MappingSuggestionList = React.memo(function MappingSuggestionList({ paperId }: MappingSuggestionListProps) {
  const { t } = useTranslation();
  const { data: mappings, isLoading } = useMappingsForPaper(paperId);
  const [filter, setFilter] = useState<FilterType>('all');

  const filtered = useMemo(() => {
    if (!mappings) return [];
    let result = mappings;
    switch (filter) {
      case 'pending':
        result = mappings.filter((m) => m.adjudicationStatus === 'pending');
        break;
      case 'high_confidence':
        result = mappings.filter((m) => m.confidence >= 0.8);
        break;
      case 'conflict':
        result = mappings.filter((m) => m.relationType === 'challenges');
        break;
    }
    return sortMappings(result);
  }, [mappings, filter]);

  if (isLoading) {
    return (
      <div style={loadingStyle}>
        {t('context.suggestionList.loading')}
      </div>
    );
  }

  const total = mappings?.length ?? 0;
  const adjudicated = mappings?.filter((m) => m.adjudicationStatus !== 'pending').length ?? 0;
  const progress = total > 0 ? (adjudicated / total) * 100 : 0;

  const progressFillStyle: React.CSSProperties = {
    height: '100%',
    width: `${progress}%`,
    backgroundColor: progress === 100 ? 'var(--success)' : 'var(--accent-color)',
    transition: 'width 300ms ease',
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('context.suggestionList.filterAll') },
    { key: 'pending', label: t('context.suggestionList.filterPending') },
    { key: 'high_confidence', label: t('context.suggestionList.filterHighConfidence') },
    { key: 'conflict', label: t('context.suggestionList.filterConflict') },
  ];

  return (
    <div>
      {/* 进度条 */}
      <div style={progressBarContainerStyle}>
        <div style={progressLabelStyle}>
          {t('context.suggestionList.progress', { adjudicated, total })}
        </div>
        <div style={progressTrackStyle}>
          <div style={progressFillStyle} />
        </div>
        {progress === 100 && (
          <div style={allAdjudicatedStyle}>
            {t('context.suggestionList.allAdjudicated')}
          </div>
        )}
      </div>

      {/* 筛选器 */}
      <div style={filterBarStyle}>
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid',
              borderColor: filter === f.key ? 'var(--accent-color)' : 'var(--border-subtle)',
              backgroundColor: filter === f.key ? 'rgba(59,130,246,0.1)' : 'transparent',
              color: filter === f.key ? 'var(--accent-color)' : 'var(--text-secondary)',
              fontSize: 'var(--text-xs)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 映射列表 */}
      {filtered.length === 0 ? (
        <div style={emptyStyle}>
          {t('context.suggestionList.noMatch')}
        </div>
      ) : (
        filtered.map((m) => <MappingCard key={m.id} mapping={m} paperId={paperId} />)
      )}
    </div>
  );
});
