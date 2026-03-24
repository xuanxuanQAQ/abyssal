/**
 * YearCell — 年份（§6.1）
 */

import React from 'react';

interface YearCellProps {
  year: number;
}

export function YearCell({ year }: YearCellProps) {
  return (
    <span style={{ fontSize: 'var(--text-sm)', textAlign: 'center', width: '100%', display: 'block' }}>
      {year}
    </span>
  );
}
