/**
 * PaperTypeCell — 类型徽标（§6.1）
 *
 * Emp/Thr/Rev/Met 彩色徽标。
 */

import React from 'react';
import type { PaperType } from '../../../../../shared-types/enums';

const TYPE_CONFIG: Record<PaperType, { label: string; bg: string }> = {
  empirical: { label: 'Emp', bg: 'rgba(59, 130, 246, 0.2)' },
  theoretical: { label: 'Thr', bg: 'rgba(139, 92, 246, 0.2)' },
  review: { label: 'Rev', bg: 'rgba(16, 185, 129, 0.2)' },
  methodological: { label: 'Met', bg: 'rgba(245, 158, 11, 0.2)' },
};

interface PaperTypeCellProps {
  paperType: PaperType;
}

export function PaperTypeCell({ paperType }: PaperTypeCellProps) {
  const config = TYPE_CONFIG[paperType];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: config.bg,
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        textAlign: 'center',
      }}
    >
      {config.label}
    </span>
  );
}
