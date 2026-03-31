/**
 * MappingCard — 单个映射卡片（§7.1）
 *
 * 显示概念名称、关系类型、置信度、证据文本。
 * 包含裁决按钮组。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
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

// ── BilingualEvidenceDisplay styles ──

const bilingualContainerStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  lineHeight: 1.5,
  marginBottom: 8,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  overflow: 'hidden',
};

const bilingualHeaderStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  padding: '2px 8px',
  backgroundColor: 'var(--bg-surface-low)',
  borderBottom: '1px solid var(--border-subtle)',
};

const bilingualColumnsStyle: React.CSSProperties = {
  display: 'flex',
};

const originalColumnStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  borderRight: '1px solid var(--border-subtle)',
};

const englishColumnStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
};

const langLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: 2,
};

const evidenceTextStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
};

const BilingualEvidenceDisplay = React.memo(function BilingualEvidenceDisplay({
  evidence,
  page,
}: {
  evidence: BilingualEvidence;
  page: number;
}) {
  const { t } = useTranslation();
  return (
    <div style={bilingualContainerStyle}>
      <div style={bilingualHeaderStyle}>
        {t('context.mappingCard.evidence', { page })}
      </div>
      <div style={bilingualColumnsStyle}>
        {/* Original text */}
        <div style={originalColumnStyle}>
          <div style={langLabelStyle}>
            {getLangLabel(evidence.originalLang)}
          </div>
          <div style={evidenceTextStyle}>{evidence.original}</div>
        </div>
        {/* English */}
        <div style={englishColumnStyle}>
          <div style={langLabelStyle}>
            English
          </div>
          <div style={evidenceTextStyle}>{evidence.en}</div>
        </div>
      </div>
    </div>
  );
});

// ── MappingCard styles ──

const conceptNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  marginBottom: 4,
};

const relationRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 'var(--text-xs)',
  marginBottom: 6,
};

const monoEvidenceStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  marginBottom: 8,
  padding: '4px 8px',
  backgroundColor: 'var(--bg-surface-low)',
  borderRadius: 'var(--radius-sm)',
  borderLeft: '2px solid var(--border-subtle)',
};

export const MappingCard = React.memo(function MappingCard({ mapping, paperId }: MappingCardProps) {
  const { t } = useTranslation();
  const adjudicated = mapping.adjudicationStatus !== 'pending';

  const containerStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    opacity: mapping.adjudicationStatus === 'rejected' ? 0.5 : 1,
  };

  return (
    <div style={containerStyle}>
      {/* 概念名 */}
      <div style={conceptNameStyle}>
        💡 {mapping.conceptId}
      </div>

      {/* 关系 + 置信度 */}
      <div style={relationRowStyle}>
        <span>
          {t('context.mappingCard.relation')}: <span style={{ color: RELATION_COLORS[mapping.relationType as RelationType] ?? 'rgb(156,163,175)' }}>
            {RELATION_EMOJI[mapping.relationType as RelationType] ?? '\u26AA'} {mapping.relationType}
          </span>
        </span>
        <span>
          {t('context.mappingCard.confidence')}: {mapping.confidence.toFixed(2)}
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
          <div style={monoEvidenceStyle}>
            {t('context.mappingCard.evidence', { page: mapping.evidencePage })}: &quot;{mapping.evidenceText.slice(0, 160)}
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
});
