/**
 * DateAddedCell — 相对时间（§6.1）
 *
 * < 1小时: "刚刚" / < 24小时: "N 小时前" / < 7天: "N 天前"
 * < 30天: "N 周前" / ≥ 30天: ISO 日期 "YYYY-MM-DD"
 */

import React, { useMemo } from 'react';

interface DateAddedCellProps {
  dateAdded: string;
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) return '刚刚';
  if (diffHours < 24) return `${Math.floor(diffHours)} 小时前`;
  if (diffDays < 7) return `${Math.floor(diffDays)} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;

  return isoDate.slice(0, 10); // YYYY-MM-DD
}

export function DateAddedCell({ dateAdded }: DateAddedCellProps) {
  const display = useMemo(() => formatRelativeTime(dateAdded), [dateAdded]);

  return (
    <span
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--text-muted)',
        textAlign: 'right',
        width: '100%',
        display: 'block',
      }}
    >
      {display}
    </span>
  );
}
