/**
 * EvidenceGapReport — 证据充分度警告卡片（§6.2）
 */

import React from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { useAppStore } from '../../../core/store';
import { getAPI } from '../../../core/ipc/bridge';

interface EvidenceGapReportProps {
  sectionId: string;
}

export function EvidenceGapReport({ sectionId }: EvidenceGapReportProps) {
  const report = useAppStore((s) => s.sectionQualityReports[sectionId]);

  if (!report || report.coverage === 'sufficient') return null;

  const isPartial = report.coverage === 'partial';
  const bgColor = isPartial ? '#FEF3C7' : '#FED7AA';
  const textColor = isPartial ? '#92400E' : '#9A3412';

  const handleDiscover = () => {
    // TODO: trigger targeted discover for this section's concepts
    void getAPI().pipeline.start('discover', { sectionId });
  };

  return (
    <div style={{
      backgroundColor: bgColor, borderRadius: 'var(--radius-md, 6px)',
      padding: '10px 12px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={14} style={{ color: textColor }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>
          证据充分度警告
        </span>
      </div>

      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: textColor, lineHeight: 1.5 }}>
        {report.gaps.map((gap, i) => (
          <li key={i}>{gap}</li>
        ))}
      </ul>

      <div style={{ marginTop: 8, fontSize: 12, color: textColor }}>
        可以针对性地补充文献或调整论证策略
      </div>

      <button
        onClick={handleDiscover}
        style={{
          marginTop: 6, display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', border: `1px solid ${textColor}40`,
          borderRadius: 4, backgroundColor: 'transparent',
          color: textColor, fontSize: 11, cursor: 'pointer',
        }}
      >
        <Search size={12} /> 触发 discover
      </button>
    </div>
  );
}
