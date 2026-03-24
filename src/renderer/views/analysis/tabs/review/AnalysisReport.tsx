/**
 * AnalysisReport -- Renders paper.analysisReport (Markdown) via
 * react-markdown + remark-gfm.
 *
 * Shows a placeholder when the report is null or empty.
 * TODO: paper.analysisReport data depends on backend analysis pipeline.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AnalysisReportProps {
  report: string | null;
}

export function AnalysisReport({ report }: AnalysisReportProps) {
  if (!report) {
    return (
      <div
        style={{
          padding: '20px 16px',
          backgroundColor: 'var(--bg-surface-low)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          textAlign: 'center',
        }}
      >
        No analysis report available yet.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '16px',
        backgroundColor: 'var(--bg-surface-low)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        overflowWrap: 'break-word',
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
    </div>
  );
}
