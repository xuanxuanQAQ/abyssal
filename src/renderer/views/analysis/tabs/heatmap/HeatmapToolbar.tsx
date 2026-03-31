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
import { useTranslation } from 'react-i18next';
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

const SORT_OPTION_KEYS: Array<{ value: SortOption; i18nKey: string }> = [
  { value: 'relevance', i18nKey: 'analysis.heatmap.sortOptions.relevance' },
  { value: 'year', i18nKey: 'analysis.heatmap.sortOptions.year' },
  { value: 'coverage', i18nKey: 'analysis.heatmap.sortOptions.coverage' },
  { value: 'author', i18nKey: 'analysis.heatmap.sortOptions.author' },
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
  const { t } = useTranslation();
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
        {t('analysis.heatmap.sort')}
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          aria-label={t('analysis.heatmap.sort')}
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
          {SORT_OPTION_KEYS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.i18nKey)}
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
        {t('analysis.heatmap.grid')}
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
            title={t('analysis.heatmap.editFramework')}
            aria-label={t('analysis.heatmap.editFramework')}
            style={iconButtonStyle}
          >
            <Pencil size={13} />
            <span style={{ fontSize: 11 }}>{t('analysis.heatmap.editFramework')}</span>
          </button>
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Refresh */}
      <button
        type="button"
        onClick={onRefresh}
        title={t('analysis.heatmap.refresh')}
        aria-label={t('analysis.heatmap.refresh')}
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
        title={t('analysis.heatmap.exportPng')}
        aria-label={t('analysis.heatmap.exportPng')}
        style={iconButtonStyle}
      >
        <Download size={14} />
        <span style={{ fontSize: 11 }}>PNG</span>
      </button>

      {/* Export CSV */}
      <button
        type="button"
        onClick={onExportCSV}
        title={t('analysis.heatmap.exportCsv')}
        aria-label={t('analysis.heatmap.exportCsv')}
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
