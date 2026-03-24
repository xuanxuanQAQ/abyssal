/**
 * ChatInput — 消息输入框（§5.5）
 *
 * - 自动增高（44px → 160px）
 * - Ctrl+Enter 发送，Shift+Enter 换行
 * - 动态占位符文本
 * - data-chat-input 属性用于 Peek 焦点保护
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { useChatStore } from '../../../core/store/useChatStore';
import type { ContextSource } from '../../../../shared-types/models';

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 160;

interface ChatInputProps {
  source: ContextSource;
  onSend: (text: string) => void;
  disabled?: boolean;
}

function getPlaceholder(source: ContextSource): string {
  switch (source.type) {
    case 'paper':
      return '询问关于这篇论文的问题…';
    case 'concept':
      return '询问关于这个概念的问题…';
    case 'mapping':
      return '询问关于这个映射的问题…';
    case 'section':
      return '询问写作建议或请求 AI 协助…';
    case 'graphNode':
      return '询问关于这个节点的问题…';
    case 'empty':
      return '向 AI 助手提问…';
  }
}

export function ChatInput({ source, onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const draft = useChatStore((s) => s.chatInputDraft);
  const setDraft = useChatStore((s) => s.setChatInputDraft);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    const shadow = shadowRef.current;
    if (!textarea || !shadow) return;

    shadow.textContent = textarea.value + '\n';
    const newHeight = Math.max(MIN_HEIGHT, Math.min(shadow.scrollHeight, MAX_HEIGHT));
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [draft, adjustHeight]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  }, [draft, disabled, onSend, setDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const hasDraft = draft.trim().length > 0;

  return (
    <div
      style={{
        padding: '8px 12px 12px',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* 影子元素：测量高度 */}
      <div
        ref={shadowRef}
        aria-hidden
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          width: 'calc(100% - 68px)',
          padding: '10px 40px 10px 14px',
          fontSize: 13,
          lineHeight: 1.5,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          data-chat-input="true"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder(source)}
          rows={1}
          disabled={disabled}
          style={{
            width: '100%',
            resize: 'none',
            border: '1px solid var(--border-default)',
            borderRadius: 12,
            padding: '10px 40px 10px 14px',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-primary)',
            backgroundColor: 'var(--bg-base)',
            outline: 'none',
            minHeight: MIN_HEIGHT,
            maxHeight: MAX_HEIGHT,
            overflow: 'auto',
            boxSizing: 'border-box',
            transition: 'border-color 150ms ease, box-shadow 150ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-color)';
            e.currentTarget.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--accent-color) 20%, transparent)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        />

        <button
          onClick={handleSend}
          disabled={!hasDraft || disabled}
          title="发送 (Ctrl+Enter)"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            borderRadius: 8,
            backgroundColor: hasDraft ? 'var(--accent-color)' : 'transparent',
            color: hasDraft ? 'white' : 'var(--text-muted)',
            cursor: hasDraft ? 'pointer' : 'default',
            transition: 'all 150ms ease',
            opacity: hasDraft ? 1 : 0.5,
          }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Ctrl+Enter 提示 */}
      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        textAlign: 'right',
        marginTop: 4,
        opacity: 0.6,
      }}>
        Ctrl+Enter 发送
      </div>
    </div>
  );
}
