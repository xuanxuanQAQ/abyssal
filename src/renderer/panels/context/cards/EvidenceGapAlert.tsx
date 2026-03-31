import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { EvidenceStatus } from '../../../../shared-types/enums';

const gapListStyle: React.CSSProperties = { margin: 0, paddingLeft: 20, color: 'var(--text-secondary)', lineHeight: 1.6 };

interface EvidenceGapAlertProps {
  gaps: string[] | undefined;
  status: EvidenceStatus | undefined;
}

export const EvidenceGapAlert = React.memo(function EvidenceGapAlert({ gaps, status }: EvidenceGapAlertProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!status || status === 'sufficient' || !gaps || gaps.length === 0) return null;

  const isMissing = status === 'missing';
  const bgColor = isMissing
    ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
    : 'color-mix(in srgb, var(--warning) 10%, transparent)';
  const borderColor = isMissing ? 'var(--danger)' : 'var(--warning)';
  const iconColor = isMissing ? 'var(--danger)' : 'var(--warning)';

  const visibleGaps = expanded ? gaps : gaps.slice(0, 3);
  const hasMore = gaps.length > 3;

  return (
    <div style={{
      padding: '8px 12px', backgroundColor: bgColor,
      borderLeft: `3px solid ${borderColor}`, borderRadius: 'var(--radius-sm)',
      margin: '0 0 8px 0', fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 600, color: iconColor }}>
        <AlertTriangle size={13} />
        {isMissing ? t('context.evidenceGap.missing') : t('context.evidenceGap.insufficient')}
      </div>
      <ul style={gapListStyle}>
        {visibleGaps.map((gap, i) => <li key={i}>{gap}</li>)}
      </ul>
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'none', border: 'none', color: iconColor, fontSize: 11,
            cursor: 'pointer', padding: '4px 0 0', display: 'flex', alignItems: 'center', gap: 2,
          }}
        >
          <ChevronDown size={11} />
          {t('context.evidenceGap.moreItems', { count: gaps.length - 3 })}
        </button>
      )}
    </div>
  );
});
