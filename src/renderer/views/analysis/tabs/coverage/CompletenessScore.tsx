/**
 * CompletenessScore -- Overall research completeness indicator.
 *
 * Shows a large percentage number, a progress bar (green fill / gray
 * remainder), and an N/M count of fully-covered concepts.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface CompletenessScoreProps {
  completeness: number; // 0-100
  completedCount: number;
  totalCount: number;
}

export function CompletenessScore({
  completeness,
  completedCount,
  totalCount,
}: CompletenessScoreProps) {
  const { t } = useTranslation();
  const clampedPct = Math.max(0, Math.min(100, completeness));

  return (
    <div
      style={{
        padding: '16px 20px',
        backgroundColor: 'var(--bg-surface-low)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {/* Percentage + count row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {clampedPct}%
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {completedCount} / {totalCount} {t('analysis.coverage.fullyCovered')}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: '100%',
          height: 8,
          backgroundColor: 'var(--text-muted)',
          borderRadius: 4,
          overflow: 'hidden',
          opacity: 0.3,
          position: 'relative',
        }}
      >
        {/* The gray track is the full bar at lower opacity above */}
      </div>
      <div
        style={{
          width: '100%',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
          marginTop: -8,
        }}
      >
        <div
          style={{
            width: `${clampedPct}%`,
            height: '100%',
            backgroundColor: 'var(--success)',
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
