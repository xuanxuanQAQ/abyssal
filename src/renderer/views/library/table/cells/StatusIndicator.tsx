import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';

export type StatusIndicatorTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type StatusIndicatorGlyph = 'dot' | 'spinner' | 'file' | 'alert';

const TONE_STYLES: Record<StatusIndicatorTone, { background: string; border: string; dot: string; icon: string }> = {
  neutral: {
    background: 'color-mix(in srgb, var(--bg-surface) 88%, var(--text-muted) 12%)',
    border: 'color-mix(in srgb, var(--border-subtle) 86%, var(--text-muted) 14%)',
    dot: 'var(--text-muted)',
    icon: 'var(--text-muted)',
  },
  success: {
    background: 'color-mix(in srgb, var(--success) 14%, var(--bg-surface) 86%)',
    border: 'color-mix(in srgb, var(--success) 28%, var(--border-subtle) 72%)',
    dot: 'var(--success)',
    icon: 'var(--success)',
  },
  warning: {
    background: 'color-mix(in srgb, var(--warning) 16%, var(--bg-surface) 84%)',
    border: 'color-mix(in srgb, var(--warning) 32%, var(--border-subtle) 68%)',
    dot: 'var(--warning)',
    icon: 'var(--warning)',
  },
  danger: {
    background: 'color-mix(in srgb, var(--danger) 14%, var(--bg-surface) 86%)',
    border: 'color-mix(in srgb, var(--danger) 30%, var(--border-subtle) 70%)',
    dot: 'var(--danger)',
    icon: 'var(--danger)',
  },
  info: {
    background: 'color-mix(in srgb, var(--info) 16%, var(--bg-surface) 84%)',
    border: 'color-mix(in srgb, var(--info) 30%, var(--border-subtle) 70%)',
    dot: 'var(--info)',
    icon: 'var(--info)',
  },
};

interface StatusIndicatorProps {
  tooltip: string;
  tone: StatusIndicatorTone;
  glyph?: StatusIndicatorGlyph | undefined;
}

function Glyph({ glyph, color }: { glyph: StatusIndicatorGlyph; color: string }) {
  if (glyph === 'spinner') {
    return <Loader2 size={10} style={{ color, animation: 'spin 1s linear infinite' }} />;
  }

  if (glyph === 'file') {
    return <FileText size={10} style={{ color }} />;
  }

  if (glyph === 'alert') {
    return <AlertTriangle size={10} style={{ color }} />;
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: color,
        display: 'inline-block',
      }}
    />
  );
}

export function StatusIndicator({ tooltip, tone, glyph = 'dot' }: StatusIndicatorProps) {
  const style = TONE_STYLES[tone];

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            aria-label={tooltip}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'default',
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                border: `1px solid ${style.border}`,
                backgroundColor: style.background,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
              }}
            >
              <Glyph glyph={glyph} color={glyph === 'dot' ? style.dot : style.icon} />
            </span>
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
            {tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}