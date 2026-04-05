/**
 * SelectionPreviewOverlay — shows the AI-generated replacement inline
 * with Accept / Reject controls.
 *
 * Positioned absolutely inside the editor container, anchored to the
 * bottom of the current editor viewport. Displays a compact diff:
 * original text (strikethrough + red) → replacement text (green).
 */

import React from 'react';
import type { SelectionPreviewState } from '../ai/useSelectionPreview';

interface SelectionPreviewOverlayProps {
  preview: SelectionPreviewState;
  onAccept: () => void;
  onReject: () => void;
}

// ── Styles ──

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  borderTop: '1px solid var(--border-subtle)',
  backgroundColor: 'var(--bg-surface)',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const headerLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--accent-color)',
};

const diffContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: '13px',
  lineHeight: 1.6,
  maxHeight: 200,
  overflowY: 'auto',
};

const originalStyle: React.CSSProperties = {
  textDecoration: 'line-through',
  color: 'var(--text-muted)',
  opacity: 0.7,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const replacementStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  borderLeft: '2px solid var(--accent-color)',
  paddingLeft: 8,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

const acceptButtonStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: 'none',
  backgroundColor: 'var(--accent-color)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 500,
};

const rejectButtonStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
};

// ── Component ──

export function SelectionPreviewOverlay({
  preview,
  onAccept,
  onReject,
}: SelectionPreviewOverlayProps): React.JSX.Element {
  return (
    <div style={overlayStyle} role="dialog" aria-label="AI 改写预览">
      <div style={headerStyle}>
        <span style={headerLabelStyle}>AI 改写预览</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          此改写仅修改选中内容，不创建新变体
        </span>
      </div>
      <div style={diffContainerStyle}>
        <div style={originalStyle}>{preview.originalText}</div>
        <div style={replacementStyle}>{preview.replacementText}</div>
      </div>
      <div style={buttonRowStyle}>
        <button
          type="button"
          style={rejectButtonStyle}
          onClick={onReject}
          aria-label="拒绝改写"
        >
          丢弃
        </button>
        <button
          type="button"
          style={acceptButtonStyle}
          onClick={onAccept}
          aria-label="接受改写"
        >
          接受
        </button>
      </div>
    </div>
  );
}
