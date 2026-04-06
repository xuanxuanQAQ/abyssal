/**
 * EvolutionTimeline — 概念演化时间线（§2.4）
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry } from '../../../../../shared-types/models';
import type { ConceptHistoryEventType } from '../../../../../shared-types/enums';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const EVENT_ICONS: Record<ConceptHistoryEventType, string> = {
  created: '🌱',
  definition_refined: '✏️',
  keywords_added: '🏷️',
  keywords_removed: '🏷️',
  maturity_upgraded: '⬆️',
  maturity_downgraded: '⬇️',
  layer_changed: '📊',
  parent_changed: '📂',
  merged_from: '🔗',
  split_into: '✂️',
  deprecated: '🗑️',
};

function formatRelativeTime(isoDate: string, t: TranslateFn): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('context.activity.justNow');
  if (mins < 60) return t('context.activity.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('context.activity.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('context.activity.daysAgo', { count: days });
}

function formatList(value: unknown, fallback?: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(fallback)) {
    return fallback.join(', ');
  }
  return typeof fallback === 'string' ? fallback : '';
}

function getSummary(
  entry: HistoryEntry,
  t: TranslateFn,
): string {
  const d = entry.details as Record<string, unknown>;
  const summary = typeof d.summary === 'string' ? d.summary : '';
  const reason = typeof d.reason === 'string' ? d.reason : '';
  const from = typeof d.from === 'string' ? d.from : '';
  const to = typeof d.to === 'string' ? d.to : '';
  switch (entry.type) {
    case 'created':
      return t('analysis.concepts.history.events.created');
    case 'definition_refined':
      return t('analysis.concepts.history.events.definitionRefined', {
        summary: summary || t('analysis.concepts.history.events.noDetails'),
      });
    case 'keywords_added':
      return t('analysis.concepts.history.events.keywordsAdded', {
        keywords: formatList(d.added, summary) || t('analysis.concepts.history.events.noDetails'),
      });
    case 'keywords_removed':
      return t('analysis.concepts.history.events.keywordsRemoved', {
        keywords: formatList(d.removed, summary) || t('analysis.concepts.history.events.noDetails'),
      });
    case 'maturity_upgraded':
      return t('analysis.concepts.history.events.maturityUpgraded', {
        from: from || summary || t('analysis.concepts.history.events.unknownValue'),
        to: to || t('analysis.concepts.history.events.unknownValue'),
      });
    case 'maturity_downgraded':
      return t('analysis.concepts.history.events.maturityDowngraded', {
        from: from || summary || t('analysis.concepts.history.events.unknownValue'),
        to: to || t('analysis.concepts.history.events.unknownValue'),
      });
    case 'merged_from':
      return t('analysis.concepts.history.events.mergedFrom', {
        source: summary || t('common.concept'),
      });
    case 'split_into':
      return t('analysis.concepts.history.events.splitInto', {
        targets: summary || t('common.concepts'),
      });
    case 'parent_changed':
      return t('analysis.concepts.history.events.parentChanged', {
        from: from || t('analysis.concepts.history.events.none'),
        to: to || t('analysis.concepts.history.events.none'),
      });
    case 'layer_changed':
      return t('analysis.concepts.history.events.layerChanged', {
        from: from || summary || t('analysis.concepts.history.events.unknownValue'),
        to: to || t('analysis.concepts.history.events.unknownValue'),
      });
    case 'deprecated':
      return t('analysis.concepts.history.events.deprecated', {
        reason: reason || t('analysis.concepts.history.events.noReason'),
      });
    default:
      return summary || entry.type;
  }
}

interface EvolutionTimelineProps {
  history: HistoryEntry[];
}

export function EvolutionTimeline({ history }: EvolutionTimelineProps) {
  const { t } = useTranslation();
  const translate: TranslateFn = (key, params) => (
    String(
      params === undefined
        ? t(key)
        : t(key, params as never)
    )
  );
  const [showAll, setShowAll] = useState(false);
  const sorted = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const visible = showAll ? sorted : sorted.slice(0, 5);
  const hiddenCount = sorted.length - 5;

  if (sorted.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('analysis.concepts.history.empty')}</div>;
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      {/* Vertical line */}
      <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, backgroundColor: 'var(--border-subtle)' }} />

      {visible.map((entry, i) => (
        <div key={`${entry.timestamp}:${entry.type}:${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, position: 'relative' }}>
          {/* Dot */}
          <span style={{ position: 'absolute', left: -17, top: 2, fontSize: 12 }}>
            {EVENT_ICONS[entry.type] ?? '●'}
          </span>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
              {getSummary(entry, translate)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }} title={entry.timestamp}>
              {formatRelativeTime(entry.timestamp, translate)}
            </div>
          </div>
        </div>
      ))}

      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: 'none', border: 'none', color: 'var(--accent-color)',
            fontSize: 12, cursor: 'pointer', padding: 0,
          }}
        >
          {t('analysis.concepts.history.showEarlier', { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}
