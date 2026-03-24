import React from 'react';

interface EdgeTooltipProps {
  edgeId: string | null;
  edgeData: { layer: string; weight: number; conceptName?: string | undefined } | null;
  position: { x: number; y: number } | null;
}

const tooltipStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 30,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
  pointerEvents: 'none' as const,
  whiteSpace: 'nowrap' as const,
};

function getTooltipText(layer: string, weight: number, conceptName?: string): string {
  switch (layer) {
    case 'citation':
      return '引用关系';
    case 'conceptAgree':
      return `概念一致: ${conceptName ?? '未知'} (置信度: ${weight.toFixed(2)})`;
    case 'conceptConflict':
      return `概念冲突: ${conceptName ?? '未知'} (置信度: ${weight.toFixed(2)})`;
    case 'semanticNeighbor':
      return `语义相似度: ${weight.toFixed(2)}`;
    default:
      return `${layer} (${weight.toFixed(2)})`;
  }
}

function EdgeTooltip({ edgeId, edgeData, position }: EdgeTooltipProps) {
  if (!edgeId || !edgeData || !position) return null;

  const text = getTooltipText(edgeData.layer, edgeData.weight, edgeData.conceptName);

  return (
    <div
      role="tooltip"
      style={{
        ...tooltipStyle,
        left: position.x + 12,
        top: position.y + 12,
      }}
    >
      {text}
    </div>
  );
}

export { EdgeTooltip };
export type { EdgeTooltipProps };
