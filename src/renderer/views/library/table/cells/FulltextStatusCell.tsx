import React from 'react';
import type { FulltextStatus } from '../../../../../shared-types/enums';
import { StatusIndicator, type StatusIndicatorGlyph, type StatusIndicatorTone } from './StatusIndicator';

const STATUS_CONFIG: Record<FulltextStatus, { tooltip: string; tone: StatusIndicatorTone; glyph?: StatusIndicatorGlyph }> = {
  not_attempted: { tooltip: '未尝试获取', tone: 'neutral' },
  pending: { tooltip: '正在获取…', tone: 'warning', glyph: 'spinner' },
  available: { tooltip: '全文已获取', tone: 'success' },
  abstract_only: { tooltip: '仅有摘要', tone: 'info', glyph: 'file' },
  failed: { tooltip: '获取失败', tone: 'danger', glyph: 'alert' },
};

interface FulltextStatusCellProps {
  status: FulltextStatus;
}

export function FulltextStatusCell({ status }: FulltextStatusCellProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_attempted;

  return <StatusIndicator tooltip={config.tooltip} tone={config.tone} glyph={config.glyph} />;
}
