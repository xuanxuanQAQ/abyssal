/**
 * ChatInput — 消息输入框（§5.5）
 *
 * - 自动增高（44px → 160px）
 * - Enter 发送，Shift+Enter 换行
 * - 动态占位符文本
 * - data-chat-input 属性用于 Peek 焦点保护
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, X, Quote, Image as ImageIcon } from 'lucide-react';
import { useChatStore } from '../../../core/store/useChatStore';
import { useReaderStore } from '../../../core/store/useReaderStore';
import type { ContextSource } from '../../../../shared-types/models';

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 160;

interface ChatInputProps {
  source: ContextSource;
  onSend: (text: string) => void;
  onAbort?: () => void;
  disabled?: boolean;
  streaming?: boolean;
}

function getPlaceholder(source: ContextSource, t: ReturnType<typeof import('react-i18next').useTranslation>['t']): string {
  switch (source.type) {
    case 'paper':
      return t('context.chat.placeholder.paper');
    case 'papers':
      return t('context.chat.placeholder.papers', { count: source.paperIds.length });
    case 'concept':
      return t('context.chat.placeholder.concept');
    case 'mapping':
      return t('context.chat.placeholder.mapping');
    case 'section':
      return t('context.chat.placeholder.section');
    case 'graphNode':
      return t('context.chat.placeholder.graphNode');
    case 'memo':
      return t('context.chat.placeholder.memo');
    case 'note':
      return t('context.chat.placeholder.note');
    case 'allSelected':
      return t('context.chat.placeholder.allSelected');
    case 'empty':
      return t('context.chat.placeholder.empty');
  }
}

export const ChatInput = React.memo(function ChatInput({ source, onSend, onAbort, disabled, streaming }: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const draft = useChatStore((s) => s.chatInputDraft);
  const setDraft = useChatStore((s) => s.setChatInputDraft);
  const quotedSelection = useReaderStore((s) => s.quotedSelection);
  const selectionPayload = useReaderStore((s) => s.selectionPayload);
  const clearQuote = useCallback(() => useReaderStore.getState().setQuotedSelection(null), []);
  const clearPayload = useCallback(() => useReaderStore.getState().setSelectionPayload(null), []);

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
    clearQuote();
    clearPayload();
  }, [draft, disabled, onSend, setDraft, clearQuote, clearPayload]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME composition guard: ignore Enter that confirms character selection
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (streaming) {
          // During streaming, Enter aborts generation
          onAbort?.();
        } else {
          handleSend();
        }
      }
    },
    [handleSend, streaming, onAbort]
  );

  const handleAbort = useCallback(() => {
    onAbort?.();
  }, [onAbort]);

  const hasDraft = draft.trim().length > 0;

  return (
    <div
      style={{
        padding: '8px 12px 12px',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* 引用卡片 */}
      {quotedSelection && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginBottom: 8,
            padding: '8px 10px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
          }}
        >
          <Quote size={14} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
          <span style={{
            flex: 1,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}>
            {quotedSelection.text}
          </span>
          <button
            type="button"
            onClick={clearQuote}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* DLA 图片截图预览 */}
      {selectionPayload?.images && selectionPayload.images.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginBottom: 8,
            padding: '8px 10px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        >
          <ImageIcon size={14} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
          <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selectionPayload.images.map((img, idx) => (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  borderRadius: 4,
                  overflow: 'hidden',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <img
                  src={img.dataUrl}
                  alt={img.type}
                  style={{
                    display: 'block',
                    maxWidth: 120,
                    maxHeight: 80,
                    objectFit: 'contain',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#fff',
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    padding: '1px 4px',
                    textTransform: 'capitalize',
                  }}
                >
                  {img.type} · p{img.pageNumber}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={clearPayload}
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

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
          placeholder={getPlaceholder(source, t)}
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

        {streaming ? (
          <button
            onClick={handleAbort}
            title={t('context.chat.stopGeneration')}
            style={{
              position: 'absolute',
              right: 5,
              top: 5,
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 10,
              backgroundColor: 'var(--danger, #ef4444)',
              color: 'white',
              cursor: 'pointer',
              transition: 'all 150ms ease',
              opacity: 1,
            }}
          >
            <Square size={12} fill="white" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!hasDraft || disabled}
            title={t('context.chat.send')}
            style={{
              position: 'absolute',
              right: 5,
              top: 5,
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 10,
              backgroundColor: hasDraft ? 'var(--accent-color)' : 'transparent',
              color: hasDraft ? 'white' : 'var(--text-muted)',
              cursor: hasDraft ? 'pointer' : 'default',
              transition: 'all 150ms ease',
              opacity: hasDraft ? 1 : 0.5,
            }}
          >
            <Send size={14} />
          </button>
        )}
      </div>

    </div>
  );
});
