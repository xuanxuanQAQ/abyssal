/**
 * ConceptDetailCard — 概念详情卡片
 *
 * 从 useConceptFramework 缓存中读取概念的名称、描述、
 * 关联论文数等信息。替代之前在 ConceptPane / GraphConceptNodePane 中的占位符。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { useConceptFramework } from '../../../core/ipc/hooks/useConcepts';

const containerStyle: React.CSSProperties = { padding: 12, borderBottom: '1px solid var(--border-subtle)' };
const headerRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const accentIconStyle: React.CSSProperties = { color: 'var(--accent-color)' };
const nameStyle: React.CSSProperties = { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' };
const mutedSmallStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' };
const dangerSmallStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--danger)' };
const descriptionStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-sm)', marginTop: 4 };
const parentIdStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 6 };

interface ConceptDetailCardProps {
  conceptId: string;
}

export const ConceptDetailCard = React.memo(function ConceptDetailCard({ conceptId }: ConceptDetailCardProps) {
  const { t } = useTranslation();
  const { data: framework, isLoading, isError } = useConceptFramework();
  const concept = framework?.concepts?.find((c) => c.id === conceptId);

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        <Lightbulb size={14} style={accentIconStyle} />
        <span style={nameStyle}>{concept?.name ?? conceptId}</span>
      </div>

      {isLoading && <div style={mutedSmallStyle}>{t('context.conceptDetail.loading')}</div>}
      {isError && <div style={dangerSmallStyle}>{t('context.conceptDetail.loadError')}</div>}

      {concept && (
        <>
          {concept.description && <p style={descriptionStyle}>{concept.description}</p>}
          {concept.parentId && <div style={parentIdStyle}>{t('context.conceptDetail.parent')}: {concept.parentId}</div>}
        </>
      )}

      {!isLoading && !isError && !concept && (
        <div style={mutedSmallStyle}>{t('context.conceptDetail.notFound')}</div>
      )}
    </div>
  );
});
