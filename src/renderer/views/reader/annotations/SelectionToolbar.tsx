import React, { useState } from 'react';
import { Highlighter, StickyNote, Tag, ChevronDown, PenLine } from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import type { HighlightColor } from '../../../../shared-types/enums';
import { HIGHLIGHT_COLOR_MAP as COLOR_MAP } from '../shared/highlightColors';

export function SelectionToolbar({
  position,
  highlightColor,
  onHighlight,
  onNote,
  onConceptTag,
  onColorChange,
  onMemo,
}: {
  position: { x: number; y: number } | null;
  highlightColor: HighlightColor;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onConceptTag: () => void;
  onColorChange: (color: HighlightColor) => void;
  /** v1.3: Record memo — opens QuickMemoFloat with selected text */
  onMemo?: () => void;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  if (position === null) {
    return null;
  }

  const toolbarStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y - 8,
    transform: 'translate(-50%, -100%)',
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '0 8px',
    backgroundColor: '#1e1e1e',
    border: '1px solid #3a3a3a',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
    zIndex: 25,
    whiteSpace: 'nowrap',
  };

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    color: '#e0e0e0',
    fontSize: 13,
  };

  const separatorStyle: React.CSSProperties = {
    width: 1,
    height: 20,
    backgroundColor: '#444',
    margin: '0 2px',
  };

  return (
    <div
      style={toolbarStyle}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Highlight button group */}
      <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        <button
          type="button"
          onClick={() => onHighlight(highlightColor)}
          style={{
            ...buttonStyle,
            flexDirection: 'column',
            gap: 0,
            padding: '4px 4px 2px',
          }}
        >
          <Highlighter size={16} />
          <div
            style={{
              width: 16,
              height: 3,
              backgroundColor: COLOR_MAP[highlightColor],
              borderRadius: 1,
            }}
          />
        </button>
        <button
          type="button"
          onClick={() => setShowColorPicker((prev) => !prev)}
          style={{
            ...buttonStyle,
            padding: '4px 2px',
          }}
        >
          <ChevronDown size={12} />
        </button>

        {showColorPicker && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              padding: 6,
              backgroundColor: '#1e1e1e',
              border: '1px solid #3a3a3a',
              borderRadius: 'var(--radius-sm)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              zIndex: 26,
            }}
          >
            <ColorPicker
              value={highlightColor}
              onChange={(color) => {
                onColorChange(color);
                setShowColorPicker(false);
              }}
            />
          </div>
        )}
      </div>

      <div style={separatorStyle} />

      {/* Note button */}
      <button type="button" onClick={onNote} style={buttonStyle}>
        <StickyNote size={16} />
        <span>笔记</span>
      </button>

      <div style={separatorStyle} />

      {/* Concept tag button */}
      <button type="button" onClick={onConceptTag} style={buttonStyle}>
        <Tag size={16} />
        <span>概念</span>
      </button>

      {/* v1.3: Quick memo button */}
      {onMemo && (
        <>
          <div style={separatorStyle} />
          <button type="button" onClick={onMemo} style={buttonStyle}>
            <PenLine size={16} />
            <span>记录</span>
          </button>
        </>
      )}
    </div>
  );
}
