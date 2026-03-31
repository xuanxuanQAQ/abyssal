/**
 * ConceptPane — 概念上下文（§3.2）
 *
 * ConceptDetailCard → ConceptMappingList → EvidencePassages
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMappingsForConcept } from '../../../core/ipc/hooks/useMappings';
import { ConceptDetailCard } from '../cards/ConceptDetailCard';
import { MappingCard } from '../cards/MappingCard';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };
const sectionStyle: React.CSSProperties = { padding: '8px 0' };
const sectionHeaderStyle: React.CSSProperties = { padding: '4px 12px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' };
const errorStyle: React.CSSProperties = { padding: 12, color: 'var(--danger)', fontSize: 'var(--text-xs)' };
const loadingStyle: React.CSSProperties = { padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' };
const emptyStyle: React.CSSProperties = { padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center' };

interface ConceptPaneProps {
  conceptId: string;
}

export const ConceptPane = React.memo(function ConceptPane({ conceptId }: ConceptPaneProps) {
  const { t } = useTranslation();
  const { data: mappings, isLoading, isError } = useMappingsForConcept(conceptId);

  return (
    <div style={scrollContainerStyle}>
      <ConceptDetailCard conceptId={conceptId} />

      {/* ConceptMappingList + EvidencePassages */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          {t('context.panes.concept.relatedMappings')} {mappings ? `(${mappings.length})` : ''}
        </div>

        {isError && <div style={errorStyle}>{t('context.panes.concept.loadError')}</div>}

        {isLoading ? (
          <div style={loadingStyle}>{t('context.panes.concept.loading')}</div>
        ) : mappings && mappings.length > 0 ? (
          mappings.map((m) => <MappingCard key={m.id} mapping={m} paperId={m.paperId} />)
        ) : !isError ? (
          <div style={emptyStyle}>{t('context.panes.concept.noMappings')}</div>
        ) : null}
      </div>
    </div>
  );
});
