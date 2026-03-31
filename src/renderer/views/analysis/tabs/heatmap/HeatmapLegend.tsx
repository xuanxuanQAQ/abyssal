/**
 * HeatmapLegend — 36px bottom bar showing color legend.
 *
 * - 4 colored squares for relationType (supports=green, challenges=red, extends=blue, unmapped=gray)
 * - Opacity gradient bar showing confidence range
 * - Adjudication indicators: check=accepted, pencil=revised, x=rejected
 */

import React from 'react';
import {
  RELATION_COLORS as COLORS_MAP,
  RELATION_LABELS_EN,
} from '../../shared/relationTheme';
import {
  ADJUDICATION_INDICATORS as SHARED_ADJ_INDICATORS,
} from '../../shared/adjudicationIndicators';
import type { AdjudicationStatus } from '../../../../../shared-types/enums';
import type { RelationType } from '../../../../../shared-types/enums';

interface LegendEntry {
  label: string;
  color: string;
}

const RELATION_COLORS: LegendEntry[] = (
  ['supports', 'challenges', 'extends', 'irrelevant'] as RelationType[]
).map((rt) => ({ label: RELATION_LABELS_EN[rt], color: COLORS_MAP[rt] }));

const ADJUDICATION_COLOR: Record<AdjudicationStatus, string> = {
  pending: 'var(--text-muted)',
  accepted: 'var(--text-success, #22c55e)',
  revised: 'var(--text-warning, #f59e0b)',
  rejected: 'var(--text-error, #ef4444)',
};

const ADJUDICATION_LEGEND = (
  ['accepted', 'revised', 'rejected'] as AdjudicationStatus[]
).map((status) => ({
  symbol: SHARED_ADJ_INDICATORS[status].symbol,
  label: SHARED_ADJ_INDICATORS[status].label,
  color: ADJUDICATION_COLOR[status],
}));

export function HeatmapLegend() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        padding: '0 12px',
        gap: 16,
        borderTop: '1px solid var(--border-subtle)',
        flexShrink: 0,
        backgroundColor: 'var(--bg-surface)',
        fontSize: 11,
        color: 'var(--text-secondary)',
        userSelect: 'none',
      }}
    >
      {/* Relation type legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {RELATION_COLORS.map((entry) => (
          <div
            key={entry.label}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                backgroundColor: entry.color,
                flexShrink: 0,
              }}
            />
            <span>{entry.label}</span>
          </div>
        ))}
      </div>

      {/* Separator */}
      <div
        style={{
          width: 1,
          height: 18,
          backgroundColor: 'var(--border-subtle)',
          flexShrink: 0,
        }}
      />

      {/* Confidence gradient */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Confidence:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 10 }}>0</span>
          <div
            style={{
              width: 80,
              height: 10,
              borderRadius: 2,
              background:
                'linear-gradient(to right, rgba(99,102,241,0.15), rgba(99,102,241,1.0))',
              border: '1px solid var(--border-subtle)',
            }}
          />
          <span style={{ fontSize: 10 }}>1</span>
        </div>
      </div>

      {/* Separator */}
      <div
        style={{
          width: 1,
          height: 18,
          backgroundColor: 'var(--border-subtle)',
          flexShrink: 0,
        }}
      />

      {/* Adjudication indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ADJUDICATION_LEGEND.map((ind) => (
          <div
            key={ind.label}
            style={{ display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <span style={{ color: ind.color, fontWeight: 700, fontSize: 13 }}>
              {ind.symbol}
            </span>
            <span>{ind.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
