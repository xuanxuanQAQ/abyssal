/**
 * CoverageTab -- Top-level coverage analysis view.
 *
 * Displays an overall CompletenessScore followed by per-concept
 * ConceptCoverageBar components.
 */

import React from 'react';
import { CompletenessScore } from './CompletenessScore';
import { ConceptCoverageBar } from './ConceptCoverageBar';
import { useCoverageData } from './useCoverageData';

export function CoverageTab() {
  const { completeness, concepts, isLoading } = useCoverageData();

  if (isLoading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        Loading coverage data...
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        No concept framework defined yet. Configure concepts to see coverage analysis.
      </div>
    );
  }

  const completedCount = concepts.filter((c) => c.score >= 1.0).length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <div style={{ padding: '20px 20px 16px' }}>
        <CompletenessScore
          completeness={Math.round(completeness)}
          completedCount={completedCount}
          totalCount={concepts.length}
        />
      </div>

      <div style={{ padding: '0 20px 24px' }}>
        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Concept Coverage ({concepts.length})
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
            />
          ))}
        </div>
      </div>
    </div>
  );
}
