/**
 * SelectCell — Checkbox 单元格（§6.1）
 */

import React from 'react';
import * as Checkbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

interface SelectCellProps {
  isSelected: boolean;
  onToggle?: () => void;
}

export function SelectCell({ isSelected, onToggle }: SelectCellProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox.Root
        checked={isSelected}
        onCheckedChange={() => onToggle?.()}
        style={{
          width: 16,
          height: 16,
          border: '1px solid var(--border-default)',
          borderRadius: 3,
          backgroundColor: isSelected ? 'var(--accent-color)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Checkbox.Indicator>
          <Check size={10} style={{ color: '#fff' }} />
        </Checkbox.Indicator>
      </Checkbox.Root>
    </div>
  );
}
