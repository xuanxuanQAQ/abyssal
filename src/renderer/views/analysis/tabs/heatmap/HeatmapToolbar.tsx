/**
 * HeatmapToolbar — 32px toolbar with sort, grid toggle, refresh, and export controls.
 *
 * Controls:
 * - Sort dropdown: Relevance/Year/Coverage/Author (native <select>)
 * - Show grid checkbox (native)
 * - Refresh button (invalidates ['mappings', 'heatmap'])
 * - Export buttons: PNG and CSV
 */

import React from 'react';
import { RefreshCw, Download, Grid3x3, Pencil } from 'lucide-react';

type SortOption = 'relevance' | 'year' | 'coverage' | 'author';

interface HeatmapToolbarProps {
  sortBy: string;
  onSortChange: (sort: SortOption) => void;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  onRefresh: () => void;
  onExportPNG: () => void;
  onExportCSV: () => void;
  onEditFramework?: (() => void) | undefined;
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'year', label: 'Year' },
  { value: 'coverage', label: 'Coverage' },
  { value: 'author', label: 'Author' },
];

export function HeatmapToolbar({
  sortBy,
  onSortChange,
  showGrid,
  onShowGridChange,
  onRefresh,
  onExportPNG,
  onExportCSV,
  onEditFramework,
}: HeatmapToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        padding: '0 8px',
        gap: 12,
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        backgroundColor: 'var(--bg-surface)',
        fontSize: 12,
      }}
    >
      {/* Sort dropdown */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--text-secondary)',
          userSelect: 'none',
        }}
      >
        Sort:
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: 12,
            padding: '2px 4px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {/* Separator */}
      <div
        style={{
          width: 1,
          height: 16,
          backgroundColor: 'var(--border-subtle)',
        }}
      />

      {/* Show grid checkbox */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Grid3x3 size={13} />
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => onShowGridChange(e.target.checked)}
          style={{ cursor: 'pointer', margin: 0 }}
        />
        Grid
      </label>

      {/* Edit concept framework button (v1.2) */}
      {onEditFramework && (
        <>
          <div
            style={{
              width: 1,
              height: 16,
              backgroundColor: 'var(--border-subtle)',
            }}
          />
          <button
            type="button"
            onClick={onEditFramework}
            title="编辑概念框架"
            style={iconButtonStyle}
          >
            <Pencil size={13} />
            <span style={{ fontSize: 11 }}>编辑概念框架</span>
          </button>
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Refresh */}
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh heatmap data"
        style={iconButtonStyle}
      >
        <RefreshCw size={14} />
      </button>

      {/* Separator */}
      <div
        style={{
          width: 1,
          height: 16,
          backgroundColor: 'var(--border-subtle)',
        }}
      />

      {/* Export PNG */}
      <button
        type="button"
        onClick={onExportPNG}
        title="Export as PNG"
        style={iconButtonStyle}
      >
        <Download size={14} />
        <span style={{ fontSize: 11 }}>PNG</span>
      </button>

      {/* Export CSV */}
      <button
        type="button"
        onClick={onExportCSV}
        title="Export as CSV"
        style={iconButtonStyle}
      >
        <Download size={14} />
        <span style={{ fontSize: 11 }}>CSV</span>
      </button>
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 6px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
};
