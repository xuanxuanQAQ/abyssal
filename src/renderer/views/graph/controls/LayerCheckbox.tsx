import React from 'react';

export interface LayerCheckboxProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  color: string;
  lineStyle: 'solid' | 'dashed' | 'curved';
}

function LinePreview({ color, lineStyle }: { color: string; lineStyle: LayerCheckboxProps['lineStyle'] }) {
  if (lineStyle === 'curved') {
    return (
      <svg width={20} height={12} viewBox="0 0 20 12" style={{ flexShrink: 0 }}>
        <path
          d="M0 10 Q5 0, 10 6 Q15 12, 20 2"
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
      </svg>
    );
  }

  return (
    <div
      style={{
        width: 20,
        height: 0,
        borderTop: `2px ${lineStyle} ${color}`,
        flexShrink: 0,
        alignSelf: 'center',
      }}
    />
  );
}

export function LayerCheckbox({ label, checked, onChange, color, lineStyle }: LayerCheckboxProps) {
  return (
    <div
      onClick={onChange}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          border: checked ? `2px solid ${color}` : '2px solid var(--border-default)',
          background: checked ? color : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 0.1s, border-color 0.1s',
        }}
      >
        {checked && (
          <svg width={10} height={10} viewBox="0 0 10 10">
            <polyline
              points="2,5 4.5,7.5 8,2.5"
              fill="none"
              stroke="#fff"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Color preview line */}
      <LinePreview color={color} lineStyle={lineStyle} />

      {/* Label */}
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        {label}
      </span>
    </div>
  );
}
