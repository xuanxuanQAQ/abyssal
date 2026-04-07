/**
 * MaturitySelector — 成熟度切换 Segmented Control（§1.2）
 *
 * 三档 Radix UI ToggleGroup。
 * 降级时弹出确认对话框。
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useAppDialog } from './useAppDialog';
import type { Maturity } from '../../shared-types/enums';

interface MaturitySelectorProps {
  value: Maturity;
  onChange: (maturity: Maturity) => void;
  disabled?: boolean;
}

const MATURITY_ORDER: Maturity[] = ['tag', 'tentative', 'working', 'established'];

const MATURITY_COLORS: Record<Maturity, string> = {
  tag: '#9CA3AF',
  tentative: '#3B82F6',
  working: '#F59E0B',
  established: '#10B981',
};

function isDowngrade(from: Maturity, to: Maturity): boolean {
  return MATURITY_ORDER.indexOf(to) < MATURITY_ORDER.indexOf(from);
}

export function MaturitySelector({ value, onChange, disabled }: MaturitySelectorProps) {
  const { t } = useTranslation();
  const { confirm, dialog } = useAppDialog();

  const handleValueChange = useCallback(
    async (next: string) => {
      if (!next || next === value) return;
      const nextMaturity = next as Maturity;
      if (isDowngrade(value, nextMaturity)) {
        const confirmed = await confirm({
          title: t('analysis.concepts.maturityDowngrade.title'),
          description: t('analysis.concepts.maturityDowngrade.description'),
          confirmLabel: t('analysis.concepts.maturityDowngrade.confirm'),
          confirmTone: 'danger',
        });
        if (confirmed) {
          onChange(nextMaturity);
        }
      } else {
        onChange(nextMaturity);
      }
    },
    [confirm, t, value, onChange],
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
          const color = MATURITY_COLORS[m];
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
                backgroundColor: isActive ? `${color}18` : 'transparent',
                color: isActive ? color : 'var(--text-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : (m === 'tag' ? 0.7 : 1),
              }}
            >
              {m === 'tag' && <span style={{ marginRight: 2, fontWeight: 700 }}>#</span>}
              {t(`analysis.merge.maturityLabels.${m}`)}
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup.Root>
      {dialog}
    </>
  );
}
