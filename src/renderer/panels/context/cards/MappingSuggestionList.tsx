/**
 * MappingSuggestionList — 映射建议列表（§7.4、§8）
 *
 * 排序：pending 在前 → confidence 降序 → challenges 优先
 * 分组：按概念 / 按状态
 * 筛选：全部 / 待裁决 / 高置信 / 冲突
 */

import React, { useState, useMemo } from 'react';
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

export function MappingSuggestionList({ paperId }: MappingSuggestionListProps) {
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
      <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        加载映射建议…
      </div>
    );
  }

  const total = mappings?.length ?? 0;
  const adjudicated = mappings?.filter((m) => m.adjudicationStatus !== 'pending').length ?? 0;
  const progress = total > 0 ? (adjudicated / total) * 100 : 0;

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待裁决' },
    { key: 'high_confidence', label: '高置信' },
    { key: 'conflict', label: '冲突' },
  ];

  return (
    <div>
      {/* 进度条 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>
          映射建议 ({adjudicated}/{total} 已裁决)
        </div>
        <div
          style={{
            height: 4,
            backgroundColor: 'var(--bg-surface-low)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              backgroundColor: progress === 100 ? 'var(--success)' : 'var(--accent-color)',
              transition: 'width 300ms ease',
            }}
          />
        </div>
        {progress === 100 && (
          <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
            ✓ 所有映射已裁决
          </div>
        )}
      </div>

      {/* 筛选器 */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
        }}
      >
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
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          无匹配的映射
        </div>
      ) : (
        filtered.map((m) => <MappingCard key={m.id} mapping={m} paperId={paperId} />)
      )}
    </div>
  );
}
