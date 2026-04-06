/**
 * ChatBubble — 单条消息气泡（§6.2）
 *
 * React.memo 隔离已完成消息，
 * 流式消息（status === 'streaming'）使用 react-markdown 实时渲染。
 *
 * 自定义组件覆盖（§6.3）：
 * - [paper:ID] → InlinePaperChip（TODO: Sub-Doc 4+）
 * - [concept:ID] → InlineConceptChip（TODO: Sub-Doc 4+）
 * - 代码块 → CodeBlock（TODO: shiki/highlight.js）
 * - 数学公式 → MathRenderer（TODO: KaTeX）
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock, Check, AlertCircle, FileEdit } from 'lucide-react';
import { ToolCallGroup } from './ToolCallGroup';
import type { ChatMessage, PendingEditorPatch } from '../../../../shared-types/models';

interface ChatBubbleProps {
  message: ChatMessage;
  onRetry?: ((messageId: string) => void) | undefined;
  onClarificationSelect?: ((messageId: string, optionId: string) => void) | undefined;
  onApplyPatch?: ((messageId: string, patchId: string) => void) | undefined;
  showAssistantLabel?: boolean;
}

function ChatBubbleInner({ message, onRetry, onClarificationSelect, onApplyPatch, showAssistantLabel = false }: ChatBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const displayContent = message.status === 'streaming'
    ? (message.streamBuffer ?? message.content)
    : message.content;

  const statusIcon = (() => {
    if (!isUser) return null;
    switch (message.status) {
      case 'sending':
        return <Clock size={12} style={{ color: 'var(--text-muted)' }} />;
      case 'sent':
        return <Check size={12} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />;
      case 'error':
        return <AlertCircle size={12} style={{ color: 'var(--danger)' }} />;
      default:
        return null;
    }
  })();

  // 用户的提问：右侧边线，极简旁注风格
  if (isUser) {
    return (
      <div className="chat-bubble chat-bubble--user" style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 24px 0 30px', marginBottom: 24 }}>
        <div className="chat-bubble-user-shell" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          maxWidth: '78%'
        }}>
          <div className="chat-bubble-user-copy" style={{
            paddingRight: 12,
            borderRight: '2px solid rgba(59, 130, 246, 0.28)',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            lineHeight: 1.6,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'right',
          }}>
            {displayContent}
          </div>
          {statusIcon && <div style={{ marginTop: 6, opacity: 0.6 }}>{statusIcon}</div>}
        </div>
      </div>
    );
  }

  // AI 的回答：左侧对齐的文档流，带有一点精美的标识
  return (
    <div className="chat-bubble chat-bubble--assistant" style={{ padding: '0 24px 0 32px', marginBottom: 30 }}>
      {showAssistantLabel && (
        <div className="chat-bubble-assistant-divider" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
          opacity: 0.72,
        }}>
          <div style={{
            width: 22,
            height: 1,
            backgroundColor: 'var(--accent-color)',
            opacity: 0.45,
            flexShrink: 0,
          }} />
          <div style={{
            height: 1,
            backgroundColor: 'var(--border-subtle)',
            flex: 1,
          }} />
        </div>
      )}

      <div className="chat-bubble-assistant-shell" style={{
        fontSize: '15px',
        lineHeight: 1.78,
        color: 'var(--text-primary)',
        fontFamily: '"Playfair Display", "Source Serif 4", Georgia, serif',
      }}>
        {/* Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ marginBottom: 16, fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px' }}>
            <ToolCallGroup toolCalls={message.toolCalls} />
          </div>
        )}

        {/* Markdown内容 */}
        {displayContent && (
          <div 
            className="chat-markdown cognitive-content"
            style={{
              '--text-primary': 'var(--text-primary)',
              '--text-secondary': 'var(--text-secondary)',
              '--link-color': 'var(--accent-color)',
              fontSize: '15px',
            } as React.CSSProperties}
          >
            <Markdown remarkPlugins={[remarkGfm]}>
              {displayContent}
            </Markdown>
          </div>
        )}

        {message.clarification && onClarificationSelect && (
          <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 8, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            {message.clarification.options.map((option) => {
              const isSelected = message.clarification?.selectedOptionId === option.id;
              const disabled = !!message.clarification?.submitting;
              return (
                <button
                  key={option.id}
                  onClick={() => onClarificationSelect(message.id, option.id)}
                  disabled={disabled}
                  style={{
                    padding: '7px 12px',
                    fontSize: 12,
                    borderRadius: 999,
                    border: isSelected
                      ? '1px solid var(--accent-color)'
                      : '1px solid var(--border-default)',
                    background: isSelected
                      ? 'color-mix(in srgb, var(--accent-color) 16%, var(--bg-base))'
                      : 'var(--bg-base)',
                    color: isSelected ? 'var(--accent-color)' : 'var(--text-secondary)',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled && !isSelected ? 0.6 : 1,
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        {/* 错误状态重试按钮 */}
        {message.status === 'error' && onRetry && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => onRetry(message.id)}
              className="chat-bubble-retry-btn"
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                color: 'var(--danger)',
                background: 'rgba(255,255,255,0.75)',
                border: '1px solid var(--danger)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {t('context.chat.retry', 'Retry Generation')}
            </button>
          </div>
        )}

        {/* Apply to Editor — 两阶段确认按钮 */}
        {message.pendingEditorPatches && message.pendingEditorPatches.length > 0 && onApplyPatch && (
          <div style={{
            marginTop: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            {message.pendingEditorPatches.map((p: PendingEditorPatch) => (
              <button
                key={p.id}
                disabled={p.applied}
                onClick={() => onApplyPatch(message.id, p.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  borderRadius: '6px',
                  border: p.applied
                    ? '1px solid var(--border-subtle)'
                    : '1px solid var(--accent-color)',
                  background: p.applied
                    ? 'var(--bg-surface-low)'
                    : 'color-mix(in srgb, var(--accent-color) 8%, var(--bg-base))',
                  color: p.applied
                    ? 'var(--text-muted)'
                    : 'var(--accent-color)',
                  cursor: p.applied ? 'default' : 'pointer',
                  width: 'fit-content',
                }}
              >
                <FileEdit size={14} />
                {p.applied
                  ? t('context.chat.patchApplied', '已应用')
                  : t('context.chat.applyToEditor', 'Apply to Editor')}
                {p.summary && !p.applied && (
                  <span style={{ opacity: 0.7, fontWeight: 400 }}>— {p.summary}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatBubble = React.memo(
  ChatBubbleInner,
  (prev, next) => {
    // 流式消息需要重渲染
    if (next.message.status === 'streaming') return false;
    // 状态变化需要重渲染（如 error → sending）
    if (prev.message.status !== next.message.status) return false;
    // pendingEditorPatches 变化需要重渲染
    if (prev.message.pendingEditorPatches !== next.message.pendingEditorPatches) return false;
    // 已完成消息完全静态化
    return prev.message.id === next.message.id
      && prev.message.content === next.message.content
      && prev.message.clarification === next.message.clarification
      && prev.showAssistantLabel === next.showAssistantLabel;
  }
);
