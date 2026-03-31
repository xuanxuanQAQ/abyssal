/**
 * RetrievalQualityBanner -- displays RAG retrieval quality status (v1.2)
 *
 * Coverage-based display:
 * - 'insufficient': red/orange banner with warning icon
 * - 'partial': yellow subtle banner
 * - 'sufficient': green subtle indicator or hidden
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import type { RetrievalQualityReport } from '../../../../shared-types/models';

interface RetrievalQualityBannerProps {
  qualityReport: RetrievalQualityReport | undefined;
}

export const RetrievalQualityBanner = React.memo(function RetrievalQualityBanner({
  qualityReport,
}: RetrievalQualityBannerProps) {
  const { t } = useTranslation();
  if (!qualityReport) return null;

  const { coverage, retryCount, gaps } = qualityReport;

  // Sufficient coverage: minimal green indicator
  if (coverage === 'sufficient') {
    return (
      <div style={sufficientStyle}>
        <CheckCircle size={12} />
        <span>{t('context.retrievalQuality.sufficient')}</span>
        {retryCount > 0 && (
          <span style={retryBadgeStyle}>{t('context.retrievalQuality.retryCount', { count: retryCount })}</span>
        )}
      </div>
    );
  }

  // Partial coverage: yellow banner
  if (coverage === 'partial') {
    return (
      <div style={partialStyle}>
        <div style={bannerHeaderStyle}>
          <AlertCircle size={14} />
          <span style={{ fontWeight: 500 }}>{t('context.retrievalQuality.partial')}</span>
          {retryCount > 0 && (
            <span style={retryBadgeStyle}>{t('context.retrievalQuality.retryCount', { count: retryCount })}</span>
          )}
        </div>
        {gaps.length > 0 && (
          <ul style={gapsListStyle}>
            {gaps.map((gap, idx) => (
              <li key={idx}>{gap}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Insufficient coverage: red/orange warning banner
  return (
    <div style={insufficientStyle}>
      <div style={bannerHeaderStyle}>
        <AlertTriangle size={14} />
        <span style={{ fontWeight: 500 }}>{t('context.retrievalQuality.insufficient')}</span>
        {retryCount > 0 && (
          <span style={retryBadgeStyle}>{t('context.retrievalQuality.retryCount', { count: retryCount })}</span>
        )}
      </div>
      {gaps.length > 0 && (
        <ul style={gapsListStyle}>
          {gaps.map((gap, idx) => (
            <li key={idx}>{gap}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

// ── Styles ──

const baseBannerStyle: React.CSSProperties = {
  margin: '4px 12px',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm, 4px)',
  fontSize: 'var(--text-xs, 11px)',
  lineHeight: 1.5,
};

const sufficientStyle: React.CSSProperties = {
  ...baseBannerStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--success, #38a169)',
  backgroundColor: 'rgba(56, 161, 105, 0.08)',
  border: '1px solid rgba(56, 161, 105, 0.2)',
};

const partialStyle: React.CSSProperties = {
  ...baseBannerStyle,
  color: 'var(--warning, #d69e2e)',
  backgroundColor: 'rgba(214, 158, 46, 0.08)',
  border: '1px solid rgba(214, 158, 46, 0.2)',
};

const insufficientStyle: React.CSSProperties = {
  ...baseBannerStyle,
  color: 'var(--danger, #e53e3e)',
  backgroundColor: 'rgba(229, 62, 62, 0.08)',
  border: '1px solid rgba(229, 62, 62, 0.2)',
};

const bannerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const retryBadgeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0 5px',
  borderRadius: 8,
  backgroundColor: 'rgba(0,0,0,0.08)',
  fontSize: 10,
  color: 'inherit',
};

const gapsListStyle: React.CSSProperties = {
  margin: '4px 0 0 20px',
  padding: 0,
  fontSize: 'var(--text-xs, 11px)',
  opacity: 0.9,
};
