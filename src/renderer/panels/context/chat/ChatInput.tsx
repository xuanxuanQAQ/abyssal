/**
 * ChatInput — 消息输入框（§5.5）
 *
 * - 自动增高（44px → 160px）
 * - Enter 发送，Shift+Enter 换行
 * - 动态占位符文本
 * - data-chat-input 属性用于 Peek 焦点保护
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, X, Quote, Image as ImageIcon, Loader2, Wrench } from 'lucide-react';
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
  statusText?: string | undefined;
  statusMode?: 'generating' | 'tool' | undefined;
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

export const ChatInput = React.memo(function ChatInput({ source, onSend, onAbort, disabled, streaming, statusText, statusMode = 'generating' }: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const draft = useChatStore((s) => s.chatInputDraft);
  const setDraft = useChatStore((s) => s.setChatInputDraft);
  const quotedSelection = useReaderStore((s) => s.quotedSelection);
  const selectionPayload = useReaderStore((s) => s.selectionPayload);
  const mappedText = quotedSelection?.text ?? selectionPayload?.text ?? null;
  const mappedPage = quotedSelection?.page ?? selectionPayload?.sourcePages?.[0] ?? null;
  const clearQuote = useCallback(() => useReaderStore.getState().setQuotedSelection(null), []);
  const clearPayload = useCallback(() => useReaderStore.getState().setSelectionPayload(null), []);
  const clearMappedSelection = useCallback(() => {
    clearQuote();
    clearPayload();
  }, [clearPayload, clearQuote]);

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
  const showStatus = Boolean(streaming && statusText);
  const composerTopPadding = showStatus ? 30 : 11;

  return (
    <div
      className="chat-input-shell"
      data-focused={isFocused ? 'true' : 'false'}
      data-streaming={streaming ? 'true' : 'false'}
      data-has-draft={hasDraft ? 'true' : 'false'}
      data-has-selection={mappedText || selectionPayload?.images?.length ? 'true' : 'false'}
      style={{
        padding: '10px 10px 10px',
        flexShrink: 0,
        position: 'relative',
        backgroundColor: 'transparent',
      }}
    >
      {/* 引用卡片 */}
      {mappedText && (
        <div
          className="chat-input-attachment-card chat-input-quote-card"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginBottom: 10,
            padding: '9px 10px',
            background: 'color-mix(in srgb, var(--bg-surface) 86%, transparent)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
          }}
        >
          <Quote size={14} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
          <div style={{
            flex: 1,
          }}>
            <div
              className="chat-input-quote-copy"
              style={{
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}>
              {mappedText}
            </div>
            {mappedPage !== null && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                p.{mappedPage}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clearMappedSelection}
            className="chat-input-attachment-clear"
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
          className="chat-input-attachment-card chat-input-image-card"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginBottom: 10,
            padding: '9px 10px',
            background: 'color-mix(in srgb, var(--bg-surface) 86%, transparent)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
          }}
        >
          <ImageIcon size={14} style={{ flexShrink: 0, marginTop: 2, opacity: 0.5 }} />
          <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selectionPayload.images.map((img, idx) => (
              <div
                key={idx}
                className="chat-input-image-thumb"
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
            className="chat-input-attachment-clear"
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
        className="chat-input-shadow"
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          width: 'calc(100% - 80px)',
          padding: `${composerTopPadding}px 52px 11px 16px`,
          fontSize: 13,
          lineHeight: 1.5,
          pointerEvents: 'none',
        }}
      />

      <div className="chat-input-composer" style={{ 
        position: 'relative', 
        marginTop: 0,
        background: 'color-mix(in srgb, var(--bg-surface-lowest) 90%, transparent)',
        border: streaming
          ? '1px solid rgba(59, 130, 246, 0.24)'
          : isFocused
            ? '1px solid rgba(59, 130, 246, 0.16)'
            : '1px solid var(--border-subtle)',
        boxShadow: streaming
          ? '0 0 0 2px color-mix(in srgb, var(--accent-color) 6%, transparent), inset 0 1px 0 rgba(255,255,255,0.26)'
          : isFocused
            ? '0 0 0 2px rgba(59, 130, 246, 0.05), inset 0 1px 0 rgba(255,255,255,0.26)'
            : 'inset 0 1px 0 rgba(255,255,255,0.24)',
        borderRadius: '18px',
        transition: 'all 180ms var(--easing-default)',
      }}>
        {showStatus && (
          <div className="chat-input-status-inline" data-mode={statusMode}>
            {statusMode === 'tool' ? (
              <Wrench size={11} style={{ flexShrink: 0 }} />
            ) : (
              <Loader2 size={11} style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            )}
            <span>{statusText}</span>
          </div>
        )}
        <div
          aria-hidden
          className="chat-input-composer-edge"
          style={{
            position: 'absolute',
            left: 16,
            right: 52,
            top: 0,
            height: 1,
            background: streaming
              ? 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.28), transparent)'
              : isFocused
                ? 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.14), transparent)'
                : 'transparent',
            transition: 'background 180ms var(--easing-default)',
          }}
        />
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          data-chat-input="true"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={getPlaceholder(source, t)}
          rows={1}
          disabled={disabled}
          style={{
            width: '100%',
            resize: 'none',
            border: 'none',
            borderRadius: 18,
            padding: `${composerTopPadding}px 54px 11px 16px`,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-primary)',
            backgroundColor: 'transparent',
            outline: 'none',
            minHeight: MIN_HEIGHT,
            maxHeight: MAX_HEIGHT,
            overflow: 'auto',
            boxSizing: 'border-box',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        />

        {streaming ? (
          <button
            onClick={handleAbort}
            className="chat-input-action-btn chat-input-action-btn--stop"
            title={t('context.chat.stopGeneration', 'Stop Generating')}
            style={{
              position: 'absolute',
              right: 10,
              bottom: 7,
              width: 28,
              height: 28,
              border: '1px solid var(--border-subtle)',
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--bg-surface-low) 86%, transparent)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 180ms var(--easing-default), color 180ms var(--easing-default), border-color 180ms var(--easing-default)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--bg-surface-low) 86%, transparent)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!hasDraft || disabled}
            className="chat-input-action-btn chat-input-action-btn--send"
            title={t('context.chat.send', 'Send message')}
            style={{
              position: 'absolute',
              right: 10,
              bottom: 7,
              width: 28,
              height: 28,
              border: hasDraft && !disabled ? '1px solid rgba(59, 130, 246, 0.16)' : '1px solid var(--border-subtle)',
              borderRadius: '50%',
              background: hasDraft && !disabled
                ? 'linear-gradient(180deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 82%, #0f172a))'
                : 'color-mix(in srgb, var(--bg-surface-low) 86%, transparent)',
              color: hasDraft && !disabled ? '#ffffff' : 'var(--text-muted)',
              cursor: hasDraft && !disabled ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 180ms var(--easing-default), transform 180ms var(--easing-default), box-shadow 180ms var(--easing-default), border-color 180ms var(--easing-default)',
              transform: hasDraft && !disabled ? 'scale(1)' : 'scale(0.96)',
              boxShadow: hasDraft && !disabled ? '0 8px 18px color-mix(in srgb, var(--accent-color) 26%, transparent)' : 'none',
            }}
            onMouseEnter={e => {
              if (hasDraft && !disabled) {
                e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
                e.currentTarget.style.transform = 'scale(1.04)';
              }
            }}
            onMouseLeave={e => {
              if (hasDraft && !disabled) {
                e.currentTarget.style.background = 'linear-gradient(180deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 82%, #0f172a))';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            <Send size={14} style={{ marginLeft: 1 }} />
          </button>
        )}
      </div>
    </div>
  );
});
