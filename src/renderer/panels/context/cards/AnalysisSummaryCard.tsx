/**
 * AnalysisSummaryCard — 分析状态摘要卡片（§3.2 ReaderPaperPane 子卡）
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Loader, AlertTriangle } from 'lucide-react';
import { usePaper } from '../../../core/ipc/hooks/usePapers';

const successIconStyle: React.CSSProperties = { color: 'var(--success)' };
const spinnerIconStyle: React.CSSProperties = { color: 'var(--accent-color)', animation: 'spin 1s linear infinite' };
const dangerIconStyle: React.CSSProperties = { color: 'var(--danger)' };
const containerStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' };
const headerRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' };
const labelStyle: React.CSSProperties = { fontWeight: 500 };
const statusTextStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginLeft: 'auto' };
const abstractStyle: React.CSSProperties = { marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 };

interface AnalysisSummaryCardProps {
  paperId: string;
}

export const AnalysisSummaryCard = React.memo(function AnalysisSummaryCard({ paperId }: AnalysisSummaryCardProps) {
  const { t } = useTranslation();
  const { data: paper } = usePaper(paperId);

  if (!paper) return null;

  const statusIcon = (() => {
    switch (paper.analysisStatus) {
      case 'completed': return <CheckCircle size={14} style={successIconStyle} />;
      case 'in_progress': return <Loader size={14} style={spinnerIconStyle} />;
      case 'failed': return <AlertTriangle size={14} style={dangerIconStyle} />;
      default: return null;
    }
  })();

  return (
    <div style={containerStyle}>
      <div style={headerRowStyle}>
        {statusIcon}
        <span style={labelStyle}>{t('context.analysisSummary.status')}</span>
        <span style={statusTextStyle}>{paper.analysisStatus}</span>
      </div>
      {paper.analysisStatus === 'completed' && paper.abstract && (
        <div style={abstractStyle}>{paper.abstract.slice(0, 200)}…</div>
      )}
    </div>
  );
});
