/**
 * MaturityBadge — 成熟度标识原子组件（§1.1）
 *
 * 在所有展示概念的位置统一渲染成熟度标识。
 * 尺寸变体：sm (14px), md (18px), lg (24px)
 */

import React from 'react';
import type { Maturity } from '../../shared-types/enums';

interface MaturityBadgeProps {
  maturity: Maturity;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = { sm: 14, md: 18, lg: 24 } as const;

const MATURITY_CONFIG: Record<Maturity, { color: string; label: string; dashArray?: string }> = {
  tag: { color: '#9CA3AF', label: 'tag', dashArray: '2,3' },
  tentative: { color: '#3B82F6', label: 'ten', dashArray: '4,4' },
  working: { color: '#F59E0B', label: 'wkn' },
  established: { color: '#10B981', label: 'est' },
};

export function MaturityBadge({ maturity, size = 'md', className }: MaturityBadgeProps) {
  const px = SIZE_MAP[size];
  const cfg = MATURITY_CONFIG[maturity]!;
  const r = px / 2 - 1;

  return (
    <span
      className={className}
      title={maturity}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`}>
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill={maturity === 'established' ? cfg.color : maturity === 'working' ? `${cfg.color}40` : maturity === 'tag' ? `${cfg.color}20` : 'none'}
          stroke={cfg.color}
          strokeWidth={maturity === 'established' ? 2 : 1}
          strokeDasharray={cfg.dashArray}
        />
        {maturity === 'working' && (
          <path
            d={`M ${px / 2} ${px / 2 - r} A ${r} ${r} 0 0 1 ${px / 2} ${px / 2 + r}`}
            fill={cfg.color}
          />
        )}
      </svg>
      {size !== 'sm' && (
        <span style={{ fontSize: size === 'lg' ? 12 : 10, color: cfg.color, fontWeight: 600 }}>
          {cfg.label}
        </span>
      )}
    </span>
  );
}

/** Graph 节点用的边框样式获取 */
export function getMaturityBorderStyle(maturity: Maturity): { stroke: string; strokeWidth: number; dashArray?: string | undefined } {
  const cfg = MATURITY_CONFIG[maturity]!;
  return {
    stroke: cfg.color,
    strokeWidth: maturity === 'established' ? 2 : 1,
    ...(cfg.dashArray !== undefined ? { dashArray: cfg.dashArray } : {}),
  };
}

export { MATURITY_CONFIG };
