/**
 * CoverageTab -- Top-level coverage analysis view.
 *
 * Displays an overall CompletenessScore followed by per-concept
 * ConceptCoverageBar components.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CompletenessScore } from './CompletenessScore';
import { ConceptCoverageBar } from './ConceptCoverageBar';
import { useCoverageData } from './useCoverageData';
import { getAPI } from '../../../../core/ipc/bridge';

export function CoverageTab() {
  const { t } = useTranslation();
  const { completeness, concepts, isLoading } = useCoverageData();
  const [discoveringConceptId, setDiscoveringConceptId] = useState<string | null>(null);

  const handleTriggerDiscover = useCallback(async (conceptId: string) => {
    setDiscoveringConceptId(conceptId);
    try {
      await getAPI().pipeline.start('discover', { conceptIds: [conceptId] });
    } finally {
      setDiscoveringConceptId((current) => (current === conceptId ? null : current));
    }
  }, []);

  if (isLoading) {
    return (
      <div className="analysis-scroll-stage workspace-empty-state" style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('analysis.coverage.loading')}
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div className="analysis-scroll-stage workspace-empty-state" style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('analysis.coverage.empty')}
      </div>
    );
  }

  const completedCount = concepts.filter((c) => c.score >= 1.0).length;

  return (
    <div
      className="analysis-scroll-stage analysis-coverage-stage"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div className="analysis-section-block" style={{ padding: '20px 20px 16px' }}>
        <CompletenessScore
          completeness={Math.round(completeness)}
          completedCount={completedCount}
          totalCount={concepts.length}
        />
      </div>

      <div className="analysis-section-block" style={{ padding: '0 20px 24px' }}>
        <h3
          className="analysis-section-title"
          style={{
            margin: '0 0 12px',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {t('analysis.coverage.conceptCount', { count: concepts.length })}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {concepts.map((c) => (
            <ConceptCoverageBar
              key={c.conceptId}
              conceptName={c.conceptName}
              conceptId={c.conceptId}
              synthesized={c.synthesized}
              analyzed={c.analyzed}
              acquired={c.acquired}
              pending={c.pending}
              excluded={c.excluded}
              total={c.total}
              isDiscovering={discoveringConceptId === c.conceptId}
              onSearchRelated={() => void handleTriggerDiscover(c.conceptId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
