/**
 * AllPapersSummaryPane — Ctrl+A 全选后的批量摘要上下文面板
 *
 * 不逐篇列出，而是展示统计信息（总数、分析状态分布、全文覆盖率）。
 * 引导用户使用工具栏批量操作或 AI 提问。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Library, CheckCircle, Clock, FileText } from 'lucide-react';
import { usePaperList } from '../../../core/ipc/hooks/usePapers';
import { useAppStore } from '../../../core/store';

const scrollContainerStyle: React.CSSProperties = { overflowY: 'auto', height: '100%' };

const headerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const accentIconStyle: React.CSSProperties = { color: 'var(--accent-color)' };

const statsContainerStyle: React.CSSProperties = {
  padding: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const statRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
};

const hintStyle: React.CSSProperties = {
  padding: '12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-muted)',
  textAlign: 'center',
  lineHeight: 1.5,
  borderTop: '1px solid var(--border-subtle)',
};

interface AllPapersSummaryPaneProps {
  excludedCount: number;
}

export const AllPapersSummaryPane = React.memo(function AllPapersSummaryPane({
  excludedCount,
}: AllPapersSummaryPaneProps) {
  const { t } = useTranslation();
  const { data: papers } = usePaperList();

  const total = papers?.length ?? 0;
  const effective = total - excludedCount;
  const analyzed = papers?.filter((p) => p.analysisStatus === 'completed').length ?? 0;
  const pending = total - analyzed;
  const withFulltext = papers?.filter((p) => p.fulltextStatus === 'available').length ?? 0;

  const headerText = excludedCount > 0
    ? t('context.allSelected.titleExcluded', { excluded: excludedCount })
    : t('context.allSelected.title');

  return (
    <div style={scrollContainerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <Library size={13} style={accentIconStyle} />
        {headerText}
      </div>

      {/* Stats */}
      <div style={statsContainerStyle}>
        {/* Total selected */}
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          color: 'var(--text-primary)',
          textAlign: 'center',
          padding: '8px 0',
        }}>
          {effective}
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 400,
            color: 'var(--text-muted)',
            marginLeft: 6,
          }}>
            / {total}
          </span>
        </div>

        {/* Analysis status */}
        <div style={statRowStyle}>
          <CheckCircle size={12} style={{ color: 'var(--success)' }} />
          {t('context.allSelected.statAnalyzed', { count: analyzed })}
        </div>
        <div style={statRowStyle}>
          <Clock size={12} style={{ color: 'var(--warning)' }} />
          {t('context.allSelected.statPending', { count: pending })}
        </div>
        <div style={statRowStyle}>
          <FileText size={12} style={{ color: 'var(--accent-color)' }} />
          {t('context.allSelected.statWithFulltext', { count: withFulltext })}
        </div>

        {/* Progress bar */}
        <div style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: 'var(--border-subtle)',
          overflow: 'hidden',
          marginTop: 4,
        }}>
          <div style={{
            height: '100%',
            width: total > 0 ? `${(analyzed / total) * 100}%` : '0%',
            backgroundColor: 'var(--success)',
            borderRadius: 2,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Hint */}
      <div style={hintStyle}>
        {t('context.allSelected.hint')}
      </div>
    </div>
  );
});
