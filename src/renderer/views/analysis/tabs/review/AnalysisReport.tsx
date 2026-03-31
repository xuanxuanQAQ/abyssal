/**
 * AnalysisReport -- Renders paper.analysisReport (Markdown) via
 * react-markdown + remark-gfm.
 *
 * Shows a placeholder when the report is null or empty.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './analysis-report.css';

interface AnalysisReportProps {
  report: string | null;
}

export function AnalysisReport({ report }: AnalysisReportProps) {
  const { t } = useTranslation();
  if (!report) {
    return (
      <div
        style={{
          padding: 'var(--space-5) var(--space-4)',
          backgroundColor: 'var(--bg-surface-low)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          textAlign: 'center',
        }}
      >
        {t('analysis.review.noReport')}
      </div>
    );
  }

  return (
    <div className="analysis-report-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
    </div>
  );
}
