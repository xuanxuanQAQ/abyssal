/**
 * ConceptDetail — 概念详情面板（§2.2）
 */

import React from 'react';
import { GitMerge, Scissors } from 'lucide-react';
import { useConceptList } from '../../../../core/ipc/hooks/useConcepts';
import { MaturitySelector } from '../../../../shared/MaturitySelector';
import { DefinitionEditor } from './DefinitionEditor';
import { KeywordEditor } from './KeywordEditor';
import { EvolutionTimeline } from './EvolutionTimeline';
import { useUpdateMaturity } from '../../../../core/ipc/hooks/useConcepts';
import type { Concept } from '../../../../../shared-types/models';

interface ConceptDetailProps {
  conceptId: string;
}

export function ConceptDetail({ conceptId }: ConceptDetailProps) {
  const { data: concepts } = useConceptList();
  const concept = concepts?.find((c) => c.id === conceptId);
  const updateMaturity = useUpdateMaturity();

  if (!concept) {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>概念未找到</div>;
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      {/* Title */}
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
        {concept.nameZh || concept.name}
      </h2>
      {concept.nameEn && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{concept.nameEn}</div>
      )}

      {/* Maturity selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>成熟度</label>
        <MaturitySelector
          value={concept.maturity}
          onChange={(m) => updateMaturity.mutate({ conceptId, maturity: m })}
          disabled={updateMaturity.isPending}
        />
      </div>

      {/* Definition */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>定义</label>
        <DefinitionEditor conceptId={conceptId} initialValue={concept.description} />
      </div>

      {/* Keywords */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>关键词</label>
        <KeywordEditor conceptId={conceptId} keywords={concept.keywords} />
      </div>

      {/* Related notes */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>关联笔记</label>
        {/* TODO: display related memos and notes */}
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>TODO: 关联碎片笔记和结构化笔记</div>
      </div>

      {/* Related papers stats */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>关联论文统计</label>
        {/* TODO: mapping stats by relation type */}
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>TODO: supports N / challenges N / extends N / operationalizes N</div>
      </div>

      {/* Evolution timeline */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>演化时间线</label>
        <EvolutionTimeline history={concept.history} />
      </div>

      {/* Merge / Split buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button style={actionBtnStyle}>
          <GitMerge size={14} /> Merge
        </button>
        <button style={actionBtnStyle}>
          <Scissors size={14} /> Split
        </button>
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '6px 14px', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm, 4px)', backgroundColor: 'transparent',
  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
};
