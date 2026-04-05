/**
 * Shared UI primitives for the settings panel.
 *
 * These are small, stateless, style-only components used across multiple tabs.
 */

import React from 'react';

// ═══════════════════════════════════════════════════════════════════
// Section
// ═══════════════════════════════════════════════════════════════════

export function Section({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: 'var(--text-primary)' }}>
        {icon}
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>{title}</h2>
      </div>
      {description && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 23px' }}>{description}</p>
      )}
      <div style={{
        background: 'var(--bg-surface-low, var(--bg-surface))',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md, 6px)',
        padding: '12px 16px',
      }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Row
// ═══════════════════════════════════════════════════════════════════

export function Row({ label, hint, children, noBorder }: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
  noBorder?: boolean | undefined;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0',
      borderBottom: noBorder ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, marginLeft: 16 }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Select
// ═══════════════════════════════════════════════════════════════════

export function Select({ value, options, onChange, width }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  width?: number | undefined;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: width ?? 200, padding: '4px 8px', fontSize: 13,
        background: 'var(--bg-base)', color: 'var(--text-primary)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)',
        outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NumberInput
// ═══════════════════════════════════════════════════════════════════

export function NumberInput({ value, min, max, step, onChange, width }: {
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  onChange: (v: number) => void;
  width?: number | undefined;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      style={{
        width: width ?? 100, padding: '4px 8px', fontSize: 13,
        background: 'var(--bg-base)', color: 'var(--text-primary)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm, 4px)',
        outline: 'none',
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// Toggle
// ═══════════════════════════════════════════════════════════════════

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        background: checked ? 'var(--accent-color)' : 'var(--bg-surface-high, #555)',
        cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        background: '#fff',
        position: 'absolute', top: 3,
        left: checked ? 19 : 3,
        transition: 'left 0.2s',
      }} />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SegmentedControl
// ═══════════════════════════════════════════════════════════════════

export function SegmentedControl({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg-surface-high, var(--bg-surface))', borderRadius: 'var(--radius-sm)', padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
            borderRadius: 'var(--radius-sm, 4px)',
            background: value === o.value ? 'var(--accent-color)' : 'transparent',
            color: value === o.value ? '#fff' : 'var(--text-secondary)',
            fontWeight: value === o.value ? 500 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// StatusBadge
// ═══════════════════════════════════════════════════════════════════

export function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm, 4px)',
      background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
    }}>
      {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SliderRow
// ═══════════════════════════════════════════════════════════════════

export function SliderRow({ label, hint, value, min, max, step, onChange, suffix, semanticLeft, semanticRight }: {
  label: string;
  hint?: string | undefined;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  onChange: (v: number) => void;
  suffix?: string | undefined;
  semanticLeft?: string | undefined;
  semanticRight?: string | undefined;
}) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
          {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {value}{suffix ?? ''}
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent-color)' }}
        />
        {(semanticLeft || semanticRight) && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
            <span>{semanticLeft}</span>
            <span>{semanticRight}</span>
          </div>
        )}
      </div>
    </div>
  );
}
