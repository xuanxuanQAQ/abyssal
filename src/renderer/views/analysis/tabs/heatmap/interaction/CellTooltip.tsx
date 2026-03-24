import React from 'react';
import type { HeatmapCell } from '../../../../../../shared-types/models';
import type { RelationType, AdjudicationStatus } from '../../../../../../shared-types/enums';
import { RELATION_LABELS_ZH, RELATION_COLORS } from '../../../shared/relationTheme';

interface CellTooltipProps {
  cell: HeatmapCell | null;
  conceptName: string;
  paperLabel: string;
  position: { x: number; y: number } | null;
  adjudicationLabel: string;
}

const RELATION_LABELS: Record<RelationType, { text: string; color: string }> = Object.fromEntries(
  (['supports', 'challenges', 'extends', 'unmapped'] as RelationType[]).map((rt) => [
    rt,
    { text: RELATION_LABELS_ZH[rt], color: RELATION_COLORS[rt] },
  ])
) as Record<RelationType, { text: string; color: string }>;

const tooltipStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 40,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  pointerEvents: 'none' as const,
  maxWidth: 280,
  lineHeight: 1.5,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  marginRight: 4,
};

const relationDotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: color,
  marginRight: 4,
  verticalAlign: 'middle',
});

function CellTooltip({
  cell,
  conceptName,
  paperLabel,
  position,
  adjudicationLabel,
}: CellTooltipProps) {
  if (!cell || !position) return null;

  const relation = RELATION_LABELS[cell.relationType];

  return (
    <div
      role="tooltip"
      style={{
        ...tooltipStyle,
        left: position.x + 14,
        top: position.y + 14,
      }}
    >
      <div style={{ marginBottom: 4, fontWeight: 600 }}>{conceptName}</div>
      <div style={{ marginBottom: 2 }}>
        <span style={labelStyle}>论文:</span>
        {paperLabel}
      </div>
      <div style={{ marginBottom: 2 }}>
        <span style={labelStyle}>关系:</span>
        <span style={relationDotStyle(relation.color)} />
        {relation.text}
      </div>
      <div style={{ marginBottom: 2 }}>
        <span style={labelStyle}>置信度:</span>
        {(cell.confidence * 100).toFixed(0)}%
      </div>
      <div style={{ marginBottom: 4 }}>
        <span style={labelStyle}>状态:</span>
        {adjudicationLabel}
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-tertiary)',
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: 4,
        }}
      >
        点击查看证据详情
      </div>
    </div>
  );
}

export { CellTooltip };
export type { CellTooltipProps };
