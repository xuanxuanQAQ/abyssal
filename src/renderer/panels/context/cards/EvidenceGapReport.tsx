/**
 * EvidenceGapReport — 证据充分度警告卡片（§6.2）
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Search } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { getAPI } from '../../../core/ipc/bridge';

interface EvidenceGapReportProps {
  sectionId: string;
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const gapListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 12,
  lineHeight: 1.5,
};

const suggestionStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const baseButtonStyle: React.CSSProperties = {
  marginTop: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 4,
  backgroundColor: 'transparent',
  fontSize: 11,
  cursor: 'pointer',
};

export const EvidenceGapReport = React.memo(function EvidenceGapReport({ sectionId }: EvidenceGapReportProps) {
  const { t } = useTranslation();
  const report = useAppStore((s) => s.sectionQualityReports[sectionId]);

  if (!report || report.coverage === 'sufficient') return null;

  const isPartial = report.coverage === 'partial';
  const bgColor = isPartial
    ? 'color-mix(in srgb, var(--warning, #d69e2e) 15%, var(--bg-surface))'
    : 'color-mix(in srgb, var(--danger, #ef4444) 15%, var(--bg-surface))';
  const textColor = isPartial ? 'var(--warning, #92400E)' : 'var(--danger, #9A3412)';

  const handleDiscover = () => {
    // TODO: trigger targeted discover for this section's concepts
    void getAPI().pipeline.start('discover', { sectionId });
  };

  const containerStyle: React.CSSProperties = useMemo(() => ({
    backgroundColor: bgColor,
    borderRadius: 'var(--radius-md, 6px)',
    padding: '10px 12px',
    marginBottom: 8,
  }), [bgColor]);

  const buttonStyle: React.CSSProperties = useMemo(() => ({
    ...baseButtonStyle,
    border: `1px solid ${textColor}40`,
    color: textColor,
  }), [textColor]);

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <AlertTriangle size={14} style={{ color: textColor }} />
        <span style={{ ...titleStyle, color: textColor }}>
          {t('context.evidenceGapReport.title')}
        </span>
      </div>

      <ul style={{ ...gapListStyle, color: textColor }}>
        {report.gaps.map((gap, i) => (
          <li key={i}>{gap}</li>
        ))}
      </ul>

      <div style={{ ...suggestionStyle, color: textColor }}>
        {t('context.evidenceGapReport.suggestion')}
      </div>

      <button
        onClick={handleDiscover}
        style={buttonStyle}
      >
        <Search size={12} /> {t('context.evidenceGapReport.triggerDiscover')}
      </button>
    </div>
  );
});
