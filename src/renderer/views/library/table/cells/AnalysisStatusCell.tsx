/**
 * AnalysisStatusCell — 分析状态图标（§6.1）
 */

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { AnalysisStatus } from '../../../../../shared-types/enums';

const STATUS_CONFIG: Record<AnalysisStatus, { icon: string; tooltip: string }> = {
  completed: { icon: '✅', tooltip: '分析完成' },
  in_progress: { icon: '⏳', tooltip: '分析中…' },
  not_started: { icon: '○', tooltip: '未分析' },
  needs_review: { icon: '⚠️', tooltip: '需要人工审阅' },
  failed: { icon: '❌', tooltip: '分析失败' },
};

interface AnalysisStatusCellProps {
  status: AnalysisStatus;
}

export function AnalysisStatusCell({ status }: AnalysisStatusCellProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span style={{ fontSize: 14, textAlign: 'center', width: '100%', display: 'block', cursor: 'default' }}>
            {config.icon}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={4}
            style={{
              padding: '4px 8px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              zIndex: 40,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            {config.tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
