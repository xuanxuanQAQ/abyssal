/**
 * MappingCard — 单个映射卡片（§7.1）
 *
 * 显示概念名称、关系类型、置信度、证据文本。
 * 包含裁决按钮组。
 */

import React from 'react';
import { AdjudicationControls } from './AdjudicationControls';
import type { ConceptMapping, BilingualEvidence } from '../../../../shared-types/models';
import { RELATION_COLORS, RELATION_EMOJI } from '../../../views/analysis/shared/relationTheme';
import type { RelationType } from '../../../../shared-types/enums';

interface MappingCardProps {
  mapping: ConceptMapping;
  paperId: string;
}

function getLangLabel(langCode: string): string {
  const langMap: Record<string, string> = {
    zh: '中文',
    'zh-CN': '中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어',
  };
  return langMap[langCode] ?? langCode;
}

function BilingualEvidenceDisplay({
  evidence,
  page,
}: {
  evidence: BilingualEvidence;
  page: number;
}) {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
        marginBottom: 8,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          padding: '2px 8px',
          backgroundColor: 'var(--bg-surface-low)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        证据 (p.{page})
      </div>
      <div style={{ display: 'flex' }}>
        {/* Original text */}
        <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
            {getLangLabel(evidence.originalLang)}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{evidence.original}</div>
        </div>
        {/* English */}
        <div style={{ flex: 1, padding: '4px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
            English
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>{evidence.en}</div>
        </div>
      </div>
    </div>
  );
}

export function MappingCard({ mapping, paperId }: MappingCardProps) {
  const adjudicated = mapping.adjudicationStatus !== 'pending';

  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        opacity: mapping.adjudicationStatus === 'rejected' ? 0.5 : 1,
      }}
    >
      {/* 概念名 */}
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 4 }}>
        💡 {mapping.conceptId}
      </div>

      {/* 关系 + 置信度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--text-xs)', marginBottom: 6 }}>
        <span>
          关系: <span style={{ color: RELATION_COLORS[mapping.relationType as RelationType] ?? 'rgb(156,163,175)' }}>
            {RELATION_EMOJI[mapping.relationType as RelationType] ?? '\u26AA'} {mapping.relationType}
          </span>
        </span>
        <span>
          置信度: {mapping.confidence.toFixed(2)}
        </span>
      </div>

      {/* 证据文本 — 双语或单语 */}
      {mapping.evidence ? (
        <BilingualEvidenceDisplay
          evidence={mapping.evidence}
          page={mapping.evidencePage}
        />
      ) : (
        mapping.evidenceText && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: 8,
              padding: '4px 8px',
              backgroundColor: 'var(--bg-surface-low)',
              borderRadius: 'var(--radius-sm)',
              borderLeft: '2px solid var(--border-subtle)',
            }}
          >
            证据 (p.{mapping.evidencePage}): &quot;{mapping.evidenceText.slice(0, 160)}
            {mapping.evidenceText.length > 160 ? '...' : ''}&quot;
          </div>
        )
      )}

      {/* 裁决控件 */}
      <AdjudicationControls
        mapping={mapping}
        paperId={paperId}
        adjudicated={adjudicated}
      />
    </div>
  );
}
