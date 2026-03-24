/**
 * 【Δ-1】AiStreamingBlockView — ReactNodeView for aiStreamingBlock.
 *
 * Visual design:
 * - Blue left border (3px, var(--accent-color))
 * - Top label "AI 正在生成..." (during streaming)
 * - Content: react-markdown renders attrs.markdown
 * - Bottom: "取消生成" button (streaming), or "生成已中断" + "保留已生成内容"/"丢弃" (on cancel)
 * - Background: var(--bg-surface)
 * - Blinking cursor animation at end during streaming
 */

import React, { useMemo, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import ReactMarkdown from 'react-markdown';
import type { AiStreamingStatus } from './aiStreamingBlockExtension';

// ─── Styles ───

const containerStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--accent-color, #89b4fa)',
  backgroundColor: 'var(--bg-surface, #1e1e2e)',
  borderRadius: '0 6px 6px 0',
  padding: '12px 16px',
  margin: '8px 0',
  position: 'relative',
};

const headerStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--accent-color, #89b4fa)',
  marginBottom: '8px',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const contentStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.7',
  color: 'var(--text-primary, #cdd6f4)',
};

const footerStyle: React.CSSProperties = {
  marginTop: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
};

const buttonBaseStyle: React.CSSProperties = {
  border: '1px solid var(--border-color, #333)',
  borderRadius: '4px',
  padding: '4px 12px',
  fontSize: '12px',
  cursor: 'pointer',
  lineHeight: '1.4',
};

const cancelButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: 'transparent',
  color: 'var(--text-secondary, #a6adc8)',
};

const keepButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: 'var(--accent-color, #89b4fa)',
  color: '#11111b',
  borderColor: 'var(--accent-color, #89b4fa)',
};

const discardButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: 'transparent',
  color: '#f38ba8',
  borderColor: '#f38ba8',
};

const blinkingCursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '2px',
  height: '1em',
  backgroundColor: 'var(--accent-color, #89b4fa)',
  marginLeft: '2px',
  verticalAlign: 'text-bottom',
  animation: 'ai-cursor-blink 1s step-end infinite',
};

const interruptedLabelStyle: React.CSSProperties = {
  color: 'var(--text-secondary, #a6adc8)',
  fontStyle: 'italic',
};

// ─── Inject blinking animation (once) ───

let styleInjected = false;

function injectBlinkAnimation(): void {
  if (styleInjected) return;
  styleInjected = true;

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes ai-cursor-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
  `;
  document.head.appendChild(styleEl);
}

// ─── Component ───

export function AiStreamingBlockView({
  node,
  editor,
  getPos,
}: NodeViewProps): React.ReactElement {
  const markdown = (node.attrs.markdown as string) ?? '';
  const status = (node.attrs.status as AiStreamingStatus) ?? 'streaming';

  // Inject CSS animation on first render
  useMemo(() => {
    injectBlinkAnimation();
  }, []);

  const pos = getPos();

  const handleCancel = useCallback(() => {
    if (pos == null) return;
    const storage = editor.extensionManager.extensions.find(
      (ext) => ext.name === 'aiStreamingBlock',
    )?.storage as { onCancel: ((p: number) => void) | null } | undefined;
    if (storage?.onCancel) {
      storage.onCancel(pos);
    } else {
      // Fallback: update status to error
      const { state } = editor.view;
      const tr = state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        status: 'error' as AiStreamingStatus,
      });
      editor.view.dispatch(tr);
    }
  }, [editor, node.attrs, pos]);

  const handleKeep = useCallback(() => {
    if (pos == null) return;
    const storage = editor.extensionManager.extensions.find(
      (ext) => ext.name === 'aiStreamingBlock',
    )?.storage as { onKeep: ((p: number) => void) | null } | undefined;
    if (storage?.onKeep) {
      storage.onKeep(pos);
    }
  }, [editor, pos]);

  const handleDiscard = useCallback(() => {
    if (pos == null) return;
    const storage = editor.extensionManager.extensions.find(
      (ext) => ext.name === 'aiStreamingBlock',
    )?.storage as { onDiscard: ((p: number) => void) | null } | undefined;
    if (storage?.onDiscard) {
      storage.onDiscard(pos);
    } else {
      // Fallback: delete the node
      const { state } = editor.view;
      const tr = state.tr.delete(pos, pos + node.nodeSize);
      editor.view.dispatch(tr);
    }
  }, [editor, node.nodeSize, pos]);

  const isStreaming = status === 'streaming';
  const isError = status === 'error';

  return (
    <NodeViewWrapper>
      <div style={containerStyle} data-status={status}>
        {/* Header */}
        <div style={headerStyle}>
          {isStreaming ? (
            <>
              <span>AI 正在生成\u2026</span>
            </>
          ) : isError ? (
            <span style={{ color: '#f38ba8' }}>生成已中断</span>
          ) : (
            <span>AI 生成完成</span>
          )}
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {markdown ? (
            <ReactMarkdown>{markdown}</ReactMarkdown>
          ) : (
            <span style={{ color: 'var(--text-secondary, #a6adc8)', fontStyle: 'italic' }}>
              等待内容...
            </span>
          )}
          {isStreaming ? <span style={blinkingCursorStyle} aria-hidden="true" /> : null}
        </div>

        {/* Footer actions */}
        <div style={footerStyle}>
          {isStreaming ? (
            <button type="button" style={cancelButtonStyle} onClick={handleCancel}>
              取消生成
            </button>
          ) : null}
          {isError ? (
            <>
              <span style={interruptedLabelStyle}>生成已中断</span>
              {markdown ? (
                <button type="button" style={keepButtonStyle} onClick={handleKeep}>
                  保留已生成内容
                </button>
              ) : null}
              <button type="button" style={discardButtonStyle} onClick={handleDiscard}>
                丢弃
              </button>
            </>
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
