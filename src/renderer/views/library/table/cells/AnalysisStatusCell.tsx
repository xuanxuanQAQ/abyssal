import React from 'react';
import type { AnalysisStatus } from '../../../../../shared-types/enums';
import { StatusIndicator, type StatusIndicatorGlyph, type StatusIndicatorTone } from './StatusIndicator';

const STATUS_CONFIG: Record<AnalysisStatus, { tooltip: string; tone: StatusIndicatorTone; glyph?: StatusIndicatorGlyph }> = {
  completed: { tooltip: '分析完成', tone: 'success' },
  in_progress: { tooltip: '分析中…', tone: 'warning', glyph: 'spinner' },
  not_started: { tooltip: '未分析', tone: 'neutral' },
  needs_review: { tooltip: '需要人工审阅', tone: 'warning', glyph: 'alert' },
  failed: { tooltip: '分析失败', tone: 'danger', glyph: 'alert' },
};

interface AnalysisStatusCellProps {
  status: AnalysisStatus;
}

export function AnalysisStatusCell({ status }: AnalysisStatusCellProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started;

  return <StatusIndicator tooltip={config.tooltip} tone={config.tone} glyph={config.glyph} />;
}
