/**
 * NavIcon — 单个导航图标（§4.3–4.4）
 *
 * 48×48px 可点击区域，左侧 3px 激活条。
 * 支持 Tooltip（500ms 延迟）和 Badge 系统。
 */

import React, { type ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Z_INDEX } from '../../styles/zIndex';

export interface NavIconProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  isActive: boolean;
  badge?: NavBadge;
  onClick: () => void;
  id: string;
}

export type NavBadge =
  | { type: 'dot'; color: string }
  | { type: 'count'; value: number; color: string };

export function NavIcon({
  icon,
  label,
  shortcut,
  isActive,
  badge,
  onClick,
  id,
}: NavIconProps) {
  const tooltipContent = shortcut ? `${label} (${shortcut})` : label;

  return (
    <Tooltip.Root delayDuration={500}>
      <Tooltip.Trigger asChild>
        <button
          id={id}
          role="tab"
          aria-selected={isActive}
          aria-label={label}
          onClick={onClick}
          onDoubleClick={(e) => e.stopPropagation()}
          className="nav-icon-btn"
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: isActive ? 'var(--bg-active)' : 'transparent',
            cursor: 'pointer',
            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          {/* §4.3 左侧激活条 */}
          {isActive && (
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 3,
                height: 20,
                borderRadius: '0 1.5px 1.5px 0',
                backgroundColor: 'var(--accent-color)',
              }}
            />
          )}

          {/* 图标 */}
          <span style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </span>

          {/* §4.4 Badge */}
          {badge && (
            <span
              aria-label={badge.type === 'count' ? `${badge.value} 个通知` : '有通知'}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                ...(badge.type === 'dot'
                  ? {
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: badge.color,
                    }
                  : {
                      minWidth: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: badge.color,
                      color: '#fff',
                      fontSize: 'var(--text-xs)',
                      lineHeight: '14px',
                      textAlign: 'center' as const,
                      padding: '0 3px',
                      fontWeight: 600,
                    }),
              }}
            >
              {badge.type === 'count' ? badge.value : null}
            </span>
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          style={{
            backgroundColor: 'var(--bg-surface-high)',
            color: 'var(--text-primary)',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            zIndex: Z_INDEX.TOOLTIP,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {tooltipContent}
          <Tooltip.Arrow
            style={{ fill: 'var(--bg-surface-high)' }}
          />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
