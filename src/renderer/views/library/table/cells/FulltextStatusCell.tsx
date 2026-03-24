/**
 * FulltextStatusCell — 全文状态图标（§6.1）
 */

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { FulltextStatus } from '../../../../../shared-types/enums';

const STATUS_CONFIG: Record<FulltextStatus, { icon: string; color: string; tooltip: string }> = {
  available: { icon: '✅', color: 'var(--success)', tooltip: '全文已获取' },
  pending: { icon: '⏳', color: 'var(--warning)', tooltip: '正在获取…' },
  failed: { icon: '⚠️', color: 'var(--danger)', tooltip: '获取失败' },
  not_attempted: { icon: '○', color: 'var(--text-muted)', tooltip: '未尝试获取' },
};

interface FulltextStatusCellProps {
  status: FulltextStatus;
}

export function FulltextStatusCell({ status }: FulltextStatusCellProps) {
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
