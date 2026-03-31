import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Hand,
  Highlighter,
  StickyNote,
  Tag,
  Square,
} from 'lucide-react';
import { useReaderStore } from '../../../core/store/useReaderStore';
import type { ZoomActions } from '../hooks/useZoom';

export interface ToolbarStripProps {
  zoomActions: ZoomActions;
}

const ZOOM_PRESETS = [
  { labelKey: 'reader.toolbar.fitWidth', value: 'fitWidth' },
  { labelKey: 'reader.toolbar.fitPage', value: 'fitPage' },
  { label: '75%', value: '0.75' },
  { label: '100%', value: '1' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.5' },
  { label: '200%', value: '2' },
] as const;

const ACTIVE_BG = 'var(--accent-color, #2563eb)';
const ACTIVE_COLOR = '#fff';

function ToolbarStrip({ zoomActions }: ToolbarStripProps) {
  const { t } = useTranslation();
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const zoomLevel = useReaderStore((s) => s.zoomLevel);
  const zoomMode = useReaderStore((s) => s.zoomMode);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setActiveAnnotationTool = useReaderStore((s) => s.setActiveAnnotationTool);

  const [pageInputValue, setPageInputValue] = useState(String(currentPage));
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);

  React.useEffect(() => {
    if (!isPageInputFocused) {
      setPageInputValue(String(currentPage));
    }
  }, [currentPage, isPageInputFocused]);

  const handlePageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPageInputValue(e.target.value);
    },
    [],
  );

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const parsed = parseInt(pageInputValue, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
          setCurrentPage(parsed);
        } else {
          setPageInputValue(String(currentPage));
        }
        (e.target as HTMLInputElement).blur();
      }
    },
    [pageInputValue, totalPages, setCurrentPage, currentPage],
  );

  const handlePageInputFocus = useCallback(() => {
    setIsPageInputFocused(true);
  }, []);

  const handlePageInputBlur = useCallback(() => {
    setIsPageInputFocused(false);
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  }, [currentPage, setCurrentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  }, [currentPage, totalPages, setCurrentPage]);

  const handleZoomModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === 'fitWidth' || value === 'fitPage') {
        zoomActions.setZoomPreset(value);
      } else {
        const level = parseFloat(value);
        if (!isNaN(level)) zoomActions.setZoomPreset(level);
      }
    },
    [zoomActions],
  );

  // Toggle: click active tool again → deselect (back to null / default select mode)
  const toggleTool = useCallback(
    (tool: 'hand' | 'textHighlight' | 'textNote' | 'textConceptTag' | 'areaHighlight') => {
      setActiveAnnotationTool(activeAnnotationTool === tool ? null : tool);
    },
    [activeAnnotationTool, setActiveAnnotationTool],
  );

  const selectValue =
    zoomMode === 'fitWidth' || zoomMode === 'fitPage'
      ? zoomMode
      : String(zoomLevel);

  const zoomPercentage = `${Math.round(zoomLevel * 100)}%`;

  const btnBase: React.CSSProperties = {
    height: 28,
    width: 28,
    padding: 0,
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  };

  const navBtnStyle: React.CSSProperties = {
    ...btnBase,
    border: '1px solid var(--border-subtle)',
    padding: '0 8px',
    width: 'auto',
    fontSize: 'var(--text-sm)',
  };

  function toolBtnStyle(tool: string): React.CSSProperties {
    const isActive = activeAnnotationTool === tool;
    return {
      ...btnBase,
      background: isActive ? ACTIVE_BG : 'transparent',
      color: isActive ? ACTIVE_COLOR : 'var(--text-primary)',
      borderRadius: 6,
    };
  }

  return (
    <div
      style={{
        height: 36,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'var(--text-xs)',
        flexShrink: 0,
      }}
    >
      {/* Page navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button type="button" style={navBtnStyle} onClick={handlePrevPage} disabled={currentPage <= 1}>
          <ChevronLeft size={14} />
        </button>
        <input
          type="text"
          value={pageInputValue}
          onChange={handlePageInputChange}
          onKeyDown={handlePageInputKeyDown}
          onFocus={handlePageInputFocus}
          onBlur={handlePageInputBlur}
          style={{
            width: 32,
            height: 26,
            textAlign: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            padding: 0,
          }}
        />
        <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>/ {totalPages}</span>
        <button type="button" style={navBtnStyle} onClick={handleNextPage} disabled={currentPage >= totalPages}>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ flex: 1 }} />

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <select
          value={selectValue}
          onChange={handleZoomModeChange}
          style={{
            height: 26,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
          }}
        >
          {ZOOM_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {'labelKey' in preset ? t(preset.labelKey) : preset.label}
            </option>
          ))}
        </select>
        <span
          style={{
            color: 'var(--text-secondary)',
            minWidth: 36,
            textAlign: 'center',
            userSelect: 'none',
          }}
        >
          {zoomPercentage}
        </span>
        <button type="button" style={navBtnStyle} onClick={zoomActions.zoomOut}>
          <ZoomOut size={14} />
        </button>
        <button type="button" style={navBtnStyle} onClick={zoomActions.zoomIn}>
          <ZoomIn size={14} />
        </button>
      </div>

      <div style={{ flex: 1 }} />

      {/* Tool buttons — Acrobat-style toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 2px',
          borderRadius: 8,
          background: 'var(--bg-surface-low, transparent)',
        }}
      >
        <button
          type="button"
          style={toolBtnStyle('hand')}
          onClick={() => toggleTool('hand')}
          title={t('reader.toolbar.hand', '抓手工具')}
        >
          <Hand size={15} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 2px' }} />

        <button
          type="button"
          style={toolBtnStyle('textHighlight')}
          onClick={() => toggleTool('textHighlight')}
          title={t('reader.toolbar.textHighlight', '高亮')}
        >
          <Highlighter size={15} />
        </button>
        <button
          type="button"
          style={toolBtnStyle('textNote')}
          onClick={() => toggleTool('textNote')}
          title={t('reader.toolbar.textNote', '笔记')}
        >
          <StickyNote size={15} />
        </button>
        <button
          type="button"
          style={toolBtnStyle('textConceptTag')}
          onClick={() => toggleTool('textConceptTag')}
          title={t('reader.toolbar.conceptTag', '概念标签')}
        >
          <Tag size={15} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--border-subtle)', margin: '0 2px' }} />

        <button
          type="button"
          style={toolBtnStyle('areaHighlight')}
          onClick={() => toggleTool('areaHighlight')}
          title={t('reader.toolbar.areaHighlight', '区域高亮')}
        >
          <Square size={15} />
        </button>
      </div>
    </div>
  );
}

export { ToolbarStrip };
