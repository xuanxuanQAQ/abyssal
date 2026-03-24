/**
 * AnalysisSummaryCard — 分析状态摘要卡片（§3.2 ReaderPaperPane 子卡）
 */

import React from 'react';
import { CheckCircle, Loader, AlertTriangle } from 'lucide-react';
import { usePaper } from '../../../core/ipc/hooks/usePapers';

interface AnalysisSummaryCardProps {
  paperId: string;
}

export function AnalysisSummaryCard({ paperId }: AnalysisSummaryCardProps) {
  const { data: paper } = usePaper(paperId);

  if (!paper) return null;

  const statusIcon = (() => {
    switch (paper.analysisStatus) {
      case 'completed':
        return <CheckCircle size={14} style={{ color: 'var(--success)' }} />;
      case 'in_progress':
        return <Loader size={14} style={{ color: 'var(--accent-color)', animation: 'spin 1s linear infinite' }} />;
      case 'failed':
        return <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />;
      default:
        return null;
    }
  })();

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
        {statusIcon}
        <span style={{ fontWeight: 500 }}>分析状态</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginLeft: 'auto' }}>
          {paper.analysisStatus}
        </span>
      </div>
      {paper.analysisStatus === 'completed' && paper.abstract && (
        <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {paper.abstract.slice(0, 200)}…
        </div>
      )}
    </div>
  );
}
