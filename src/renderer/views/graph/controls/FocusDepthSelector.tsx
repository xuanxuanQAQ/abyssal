import React from 'react';
import { useAppStore } from '../../../core/store';

type FocusDepthValue = '1-hop' | '2-hop' | 'global';

const segments: { value: FocusDepthValue; label: string }[] = [
  { value: '1-hop', label: '1-hop' },
  { value: '2-hop', label: '2-hop' },
  { value: 'global', label: '全局' },
];

export function FocusDepthSelector() {
  const focusDepth = useAppStore((s) => s.focusDepth);
  const setFocusDepth = useAppStore((s) => s.setFocusDepth);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
        Focus Depth
      </span>

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          height: 28,
        }}
      >
        {segments.map((seg) => {
          const selected = focusDepth === seg.value;
          return (
            <button
              key={seg.value}
              onClick={() => setFocusDepth(seg.value)}
              style={{
                flex: 1,
                height: '100%',
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                background: selected ? 'var(--accent-color)' : 'transparent',
                color: selected ? '#fff' : 'var(--text-secondary)',
                transition: 'background 0.15s, color 0.15s',
                padding: 0,
              }}
            >
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
