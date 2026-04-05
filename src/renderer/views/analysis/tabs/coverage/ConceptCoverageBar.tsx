/**
 * ConceptCoverageBar -- Stacked horizontal bar for a single concept's
 * paper coverage breakdown.
 *
 * Segment colors (section 11.2):
 *   synthesized: var(--success)      green
 *   analyzed:    var(--accent-color)  blue
 *   acquired:    var(--warning)       orange
 *   pending:     var(--text-muted)    gray
 *   excluded:    var(--danger)        red, semi-transparent
 *
 * Shows a warning icon when total coverage is 0 or < 3, and a
 * targeted discover action when coverage is zero.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface ConceptCoverageBarProps {
  conceptName: string;
  conceptId: string;
  synthesized: number;
  analyzed: number;
  acquired: number;
  pending: number;
  excluded: number;
  total: number;
  isDiscovering?: boolean;
  onSearchRelated?: (() => void) | undefined;
}

interface Segment {
  count: number;
  color: string;
  label: string;
  opacity: number;
}

export function ConceptCoverageBar({
  conceptName,
  conceptId,
  synthesized,
  analyzed,
  acquired,
  pending,
  excluded,
  total,
  isDiscovering = false,
  onSearchRelated,
}: ConceptCoverageBarProps) {
  const { t } = useTranslation();
  const segments: Segment[] = [
    { count: synthesized, color: 'var(--success)', label: t('analysis.coverage.synthesized'), opacity: 1 },
    { count: analyzed, color: 'var(--accent-color)', label: t('analysis.coverage.analyzed'), opacity: 1 },
    { count: acquired, color: 'var(--warning)', label: t('analysis.coverage.acquired'), opacity: 1 },
    { count: pending, color: 'var(--text-muted)', label: t('analysis.coverage.pending'), opacity: 1 },
    { count: excluded, color: 'var(--danger)', label: t('analysis.coverage.excluded'), opacity: 0.4 },
  ];

  const nonExcludedTotal = synthesized + analyzed + acquired + pending;
  const showWarning = total === 0 || nonExcludedTotal < 3;
  const showSearchButton = total === 0 && onSearchRelated !== undefined;

  return (
    <div
      className="analysis-coverage-card"
      style={{
        padding: '8px 12px',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--bg-surface-low)',
      }}
    >
      {/* Header row: concept name + warning + total */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {showWarning && (
            <span
              title={
                total === 0
                  ? t('analysis.coverage.noCoverage')
                  : t('analysis.coverage.lowCoverage')
              }
              style={{ fontSize: 14, lineHeight: 1 }}
            >
              {'\u26A0'}
            </span>
          )}
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {conceptName}
          </span>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
            }}
          >
            ({conceptId})
          </span>
        </div>

        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {total} {total !== 1 ? t('analysis.coverage.paperPlural') : t('analysis.coverage.paperSingular')}
        </span>
      </div>

      {/* Stacked bar */}
      {total > 0 ? (
        <div
          role="progressbar"
          aria-valuenow={Math.round(((synthesized + analyzed) / total) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('analysis.coverage.progressLabel', {
            concept: conceptName,
            defaultValue: `${conceptName} coverage`,
          })}
          style={{
            display: 'flex',
            width: '100%',
            height: 6,
            borderRadius: 3,
            overflow: 'hidden',
            backgroundColor: 'var(--bg-base)',
          }}
        >
          {segments.map((seg) => {
            if (seg.count === 0) return null;
            const pct = (seg.count / total) * 100;
            return (
              <div
                key={seg.label}
                className="analysis-coverage-segment"
                title={`${seg.label}: ${seg.count}`}
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  backgroundColor: seg.color,
                  opacity: seg.opacity,
                  minWidth: seg.count > 0 ? 2 : 0,
                }}
              />
            );
          })}
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: 6,
            borderRadius: 3,
            backgroundColor: 'var(--bg-base)',
          }}
        />
      )}

      {/* Legend row */}
      {total > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 4,
            flexWrap: 'wrap',
          }}
        >
          {segments
            .filter((seg) => seg.count > 0)
            .map((seg) => (
              <span
                key={seg.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: seg.color,
                    opacity: seg.opacity,
                  }}
                />
                {seg.label} {seg.count}
              </span>
            ))}
        </div>
      )}

      {/* Search related button for zero-coverage concepts */}
      {showSearchButton && (
        <button
          type="button"
          onClick={onSearchRelated}
          disabled={isDiscovering}
          className="analysis-action-btn analysis-coverage-search-btn"
          style={{
            marginTop: 6,
            padding: '4px 10px',
            border: '1px solid var(--accent-color)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--accent-color)',
            fontSize: 'var(--text-xs)',
            cursor: isDiscovering ? 'default' : 'pointer',
            opacity: isDiscovering ? 0.7 : 1,
          }}
        >
          {isDiscovering ? t('analysis.coverage.discovering') : t('analysis.coverage.triggerDiscover')}
        </button>
      )}
    </div>
  );
}
