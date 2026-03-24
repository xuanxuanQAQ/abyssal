/**
 * QuickActions — 论文快速操作按钮组（§3.2 LibraryPaperPane 子卡）
 *
 * 三个操作：分析 / 获取全文 / 打开 PDF
 */

import React from 'react';
import { Microscope, Download, FileText } from 'lucide-react';
import { useAppStore } from '../../../core/store';

interface QuickActionsProps {
  paperId: string;
}

export function QuickActions({ paperId }: QuickActionsProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  const actions = [
    {
      icon: <Microscope size={14} />,
      label: '分析',
      onClick: () => {
        // TODO: 触发 analyze pipeline
      },
    },
    {
      icon: <Download size={14} />,
      label: '获取全文',
      onClick: () => {
        // TODO: 触发 acquire pipeline
      },
    },
    {
      icon: <FileText size={14} />,
      label: '打开 PDF',
      onClick: () => {
        navigateTo({ type: 'paper', id: paperId, view: 'reader' });
      },
    },
  ];

  return (
    <div
      style={{
        padding: '8px 12px',
        display: 'flex',
        gap: 8,
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '6px 0',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'none',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
