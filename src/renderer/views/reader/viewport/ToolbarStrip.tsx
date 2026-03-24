import React, { useState, useCallback } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
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
  { label: 'Fit Width', value: 'fitWidth' },
  { label: 'Fit Page', value: 'fitPage' },
  { label: '75%', value: '0.75' },
  { label: '100%', value: '1' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.5' },
  { label: '200%', value: '2' },
] as const;

const buttonStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--text-sm)',
};

const toggleItemStyle: React.CSSProperties = {
  ...buttonStyle,
  border: 'none',
};

function ToolbarStrip({ zoomActions }: ToolbarStripProps) {
  const currentPage = useReaderStore((s) => s.currentPage);
  const totalPages = useReaderStore((s) => s.totalPages);
  const zoomLevel = useReaderStore((s) => s.zoomLevel);
  const zoomMode = useReaderStore((s) => s.zoomMode);
  const activeAnnotationTool = useReaderStore((s) => s.activeAnnotationTool);
  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setActiveAnnotationTool = useReaderStore((s) => s.setActiveAnnotationTool);

  const [pageInputValue, setPageInputValue] = useState(String(currentPage));
  const [isPageInputFocused, setIsPageInputFocused] = useState(false);

  // Keep input in sync when page changes externally (only when not focused)
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
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage, setCurrentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, totalPages, setCurrentPage]);

  const handleZoomModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === 'fitWidth' || value === 'fitPage') {
        zoomActions.setZoomPreset(value);
      } else {
        const level = parseFloat(value);
        if (!isNaN(level)) {
          zoomActions.setZoomPreset(level);
        }
      }
    },
    [zoomActions],
  );

  // Text annotation tools toggle group
  const textToolValue =
    activeAnnotationTool === 'textHighlight' ||
    activeAnnotationTool === 'textNote' ||
    activeAnnotationTool === 'textConceptTag'
      ? activeAnnotationTool
      : '';

  const handleTextToolChange = useCallback(
    (value: string) => {
      if (value === '') {
        // Deselected
        setActiveAnnotationTool(null);
      } else {
        setActiveAnnotationTool(
          value as 'textHighlight' | 'textNote' | 'textConceptTag',
        );
      }
    },
    [setActiveAnnotationTool],
  );

  const handleAreaHighlightToggle = useCallback(() => {
    if (activeAnnotationTool === 'areaHighlight') {
      setActiveAnnotationTool(null);
    } else {
      setActiveAnnotationTool('areaHighlight');
    }
  }, [activeAnnotationTool, setActiveAnnotationTool]);

  // Determine current select value
  const selectValue =
    zoomMode === 'fitWidth' || zoomMode === 'fitPage'
      ? zoomMode
      : String(zoomLevel);

  const zoomPercentage = `${Math.round(zoomLevel * 100)}%`;

  return (
    <div
      style={{
        height: 32,
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
      {/* Left group: page navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={handlePrevPage}
          disabled={currentPage <= 1}
          aria-label="Previous page"
        >
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
            width: 30,
            height: 28,
            textAlign: 'center',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-xs)',
            padding: 0,
          }}
        />
        <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>
          / {totalPages}
        </span>
        <button
          type="button"
          style={buttonStyle}
          onClick={handleNextPage}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Center group: zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <select
          value={selectValue}
          onChange={handleZoomModeChange}
          style={{
            height: 28,
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
              {preset.label}
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
        <button
          type="button"
          style={buttonStyle}
          onClick={zoomActions.zoomOut}
          aria-label="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          style={buttonStyle}
          onClick={zoomActions.zoomIn}
          aria-label="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Right group A: text annotation tools */}
      <ToggleGroup.Root
        type="single"
        value={textToolValue}
        onValueChange={handleTextToolChange}
        style={{ display: 'flex', alignItems: 'center', gap: 2 }}
      >
        <ToggleGroup.Item
          value="textHighlight"
          style={{
            ...toggleItemStyle,
            background:
              activeAnnotationTool === 'textHighlight'
                ? 'var(--bg-elevated)'
                : 'transparent',
          }}
          aria-label="Text highlight"
        >
          <Highlighter size={14} />
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="textNote"
          style={{
            ...toggleItemStyle,
            background:
              activeAnnotationTool === 'textNote'
                ? 'var(--bg-elevated)'
                : 'transparent',
          }}
          aria-label="Text note"
        >
          <StickyNote size={14} />
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="textConceptTag"
          style={{
            ...toggleItemStyle,
            background:
              activeAnnotationTool === 'textConceptTag'
                ? 'var(--bg-elevated)'
                : 'transparent',
          }}
          aria-label="Concept tag"
        >
          <Tag size={14} />
        </ToggleGroup.Item>
      </ToggleGroup.Root>

      {/* Right group B: area highlight toggle */}
      <button
        type="button"
        style={{
          ...buttonStyle,
          background:
            activeAnnotationTool === 'areaHighlight'
              ? 'var(--bg-elevated)'
              : 'transparent',
          border: 'none',
        }}
        onClick={handleAreaHighlightToggle}
        aria-label="Area highlight"
      >
        <Square size={14} />
      </button>
    </div>
  );
}

export { ToolbarStrip };
