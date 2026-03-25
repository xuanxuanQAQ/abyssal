/**
 * PaperTypeCell — 类型徽标（§6.1）
 *
 * 显示论文类型的彩色徽标。
 * 兼容后端 PaperType (journal/conference/book/...) 和前端旧类型 (empirical/theoretical/...)。
 */

import React from 'react';

const TYPE_CONFIG: Record<string, { label: string; bg: string }> = {
  // 后端类型
  journal: { label: 'Jnl', bg: 'rgba(59, 130, 246, 0.2)' },
  conference: { label: 'Conf', bg: 'rgba(139, 92, 246, 0.2)' },
  book: { label: 'Book', bg: 'rgba(16, 185, 129, 0.2)' },
  chapter: { label: 'Chap', bg: 'rgba(20, 184, 166, 0.2)' },
  preprint: { label: 'Pre', bg: 'rgba(245, 158, 11, 0.2)' },
  review: { label: 'Rev', bg: 'rgba(16, 185, 129, 0.2)' },
  // 前端旧类型（向后兼容）
  empirical: { label: 'Emp', bg: 'rgba(59, 130, 246, 0.2)' },
  theoretical: { label: 'Thr', bg: 'rgba(139, 92, 246, 0.2)' },
  methodological: { label: 'Met', bg: 'rgba(245, 158, 11, 0.2)' },
};

const FALLBACK = { label: '?', bg: 'rgba(107, 114, 128, 0.2)' };

interface PaperTypeCellProps {
  paperType: string;
}

export function PaperTypeCell({ paperType }: PaperTypeCellProps) {
  const config = TYPE_CONFIG[paperType] ?? FALLBACK;

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
