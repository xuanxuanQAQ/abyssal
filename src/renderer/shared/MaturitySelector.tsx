/**
 * MaturitySelector — 成熟度切换 Segmented Control（§1.2）
 *
 * 三档 Radix UI ToggleGroup。
 * 降级时弹出确认对话框。
 */

import React, { useCallback } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useAppDialog } from './useAppDialog';
import type { Maturity } from '../../shared-types/enums';

interface MaturitySelectorProps {
  value: Maturity;
  onChange: (maturity: Maturity) => void;
  disabled?: boolean;
}

const MATURITY_ORDER: Maturity[] = ['tentative', 'working', 'established'];

const MATURITY_LABELS: Record<Maturity, { label: string; color: string }> = {
  tentative: { label: 'Tentative', color: '#3B82F6' },
  working: { label: 'Working', color: '#F59E0B' },
  established: { label: 'Established', color: '#10B981' },
};

function isDowngrade(from: Maturity, to: Maturity): boolean {
  return MATURITY_ORDER.indexOf(to) < MATURITY_ORDER.indexOf(from);
}

export function MaturitySelector({ value, onChange, disabled }: MaturitySelectorProps) {
  const { confirm, dialog } = useAppDialog();

  const handleValueChange = useCallback(
    async (next: string) => {
      if (!next || next === value) return;
      const nextMaturity = next as Maturity;
      if (isDowngrade(value, nextMaturity)) {
        const confirmed = await confirm({
          title: '确认降级成熟度',
          description: '降级成熟度将影响后续分析的 prompt 指令和检索策略，是否继续？',
          confirmLabel: '继续降级',
          confirmTone: 'danger',
        });
        if (confirmed) {
          onChange(nextMaturity);
        }
      } else {
        onChange(nextMaturity);
      }
    },
    [confirm, value, onChange],
  );

  return (
    <>
      <ToggleGroup.Root
        type="single"
        value={value}
        onValueChange={handleValueChange}
        style={{
          display: 'inline-flex',
          borderRadius: 'var(--radius-md, 6px)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        {MATURITY_ORDER.map((m) => {
          const cfg = MATURITY_LABELS[m]!;
          const isActive = m === value;
          return (
            <ToggleGroup.Item
              key={m}
              value={m}
              disabled={disabled}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                border: 'none',
                borderRight: m !== 'established' ? '1px solid var(--border-subtle)' : 'none',
                backgroundColor: isActive ? `${cfg.color}18` : 'transparent',
                color: isActive ? cfg.color : 'var(--text-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {cfg.label}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
      {dialog}
    </>
  );
}
