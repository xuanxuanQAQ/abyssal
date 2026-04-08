/**
 * SelectionPreviewOverlay — shows the AI-generated replacement inline
 * with Accept / Reject controls.
 *
 * Two modes:
 *   - Streaming: text appears progressively with a blinking cursor.
 *     Accept/Reject buttons are disabled until generation finishes.
 *   - Final: full diff is shown. User can accept or reject.
 *
 * Positioned absolutely inside the editor container, anchored to the
 * bottom of the current editor viewport.
 */

import React, { useEffect, useRef } from 'react';
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

const _disabledButtonStyle: React.CSSProperties = {
  ...rejectButtonStyle,
  opacity: 0.4,
  cursor: 'default',
};

const cursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 2,
  height: '1em',
  backgroundColor: 'var(--accent-color)',
  marginLeft: 1,
  verticalAlign: 'text-bottom',
  animation: 'blink 1s steps(2) infinite',
};

// ── Component ──

export function SelectionPreviewOverlay({
  preview,
  onAccept,
  onReject,
}: SelectionPreviewOverlayProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (preview.streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [preview.streaming, preview.replacementText]);

  // Escape key dismisses / cancels the preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onReject();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onReject]);

  const isReplace = preview.originalText.length > 0;
  const hasError = Boolean(preview.error);

  return (
    <div style={overlayStyle} role="dialog" aria-label="AI 改写预览">
      {/* Inline keyframes for cursor blink */}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      <div style={headerStyle}>
        <span style={{
          ...headerLabelStyle,
          ...(hasError ? { color: 'var(--color-danger, #ef4444)' } : {}),
        }}>
          {hasError
            ? '生成失败'
            : preview.streaming
              ? (isReplace ? 'AI 正在改写...' : 'AI 正在续写...')
              : (isReplace ? 'AI 改写预览' : 'AI 续写预览')}
        </span>
        {!preview.streaming && !hasError && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {isReplace
              ? '此改写仅修改选中内容，不创建新变体'
              : '内容将插入到当前位置之后'}
          </span>
        )}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Esc 关闭</span>
      </div>

      {hasError ? (
        <div style={{ fontSize: '13px', color: 'var(--color-danger, #ef4444)', padding: '4px 0' }}>
          {preview.error}
        </div>
      ) : (
        <div ref={scrollRef} style={diffContainerStyle}>
          {isReplace && <div style={originalStyle}>{preview.originalText}</div>}
          <div style={replacementStyle}>
            {preview.replacementText}
            {preview.streaming && <span style={cursorStyle} />}
          </div>
        </div>
      )}

      <div style={buttonRowStyle}>
        {preview.streaming ? (
          <button
            type="button"
            style={rejectButtonStyle}
            onClick={onReject}
            aria-label="取消生成"
          >
            取消
          </button>
        ) : hasError ? (
          <button
            type="button"
            style={rejectButtonStyle}
            onClick={onReject}
            aria-label="关闭"
          >
            关闭
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
