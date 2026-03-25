/**
 * EvidenceGapBadge — 纲要节标题旁的证据充分度 badge（§6.1）
 *
 * 数据来自 Zustand sectionQualityReports。
 */

import React from 'react';
import { useAppStore } from '../../../core/store';

interface EvidenceGapBadgeProps {
  sectionId: string;
}

export function EvidenceGapBadge({ sectionId }: EvidenceGapBadgeProps) {
  const report = useAppStore((s) => s.sectionQualityReports[sectionId]);

  if (!report || report.coverage === 'sufficient') return null;

  const isPartial = report.coverage === 'partial';
  const color = isPartial ? '#EAB308' : '#F97316';
  const tooltip = isPartial
    ? '部分论点的文献覆盖有限'
    : `文献覆盖不足：${report.gaps[0] ?? ''}`;

  return (
    <span title={tooltip} style={{ display: 'inline-flex', flexShrink: 0, marginLeft: 4 }}>
      <svg width={10} height={10} viewBox="0 0 10 10">
        <circle cx={5} cy={5} r={4} fill={color} />
      </svg>
    </span>
  );
}
