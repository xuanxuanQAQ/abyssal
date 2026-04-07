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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock, Check, AlertCircle, FileEdit, Quote, Image as ImageIcon, PenTool, MapPin, ChevronRight, Brain } from 'lucide-react';
import { ToolCallGroup } from './ToolCallGroup';
import type { ChatMessage, MessageAttachment, PendingEditorPatch } from '../../../../shared-types/models';

interface ChatBubbleProps {
  message: ChatMessage;
  onRetry?: ((messageId: string) => void) | undefined;
  onClarificationSelect?: ((messageId: string, optionId: string) => void) | undefined;
  onApplyPatch?: ((messageId: string, patchId: string) => void) | undefined;
  showAssistantLabel?: boolean;
}

/** 已发送消息上的上下文附件精简标签 */
function AttachmentChips({ attachments, t }: { attachments: MessageAttachment[]; t: ReturnType<typeof import('react-i18next').useTranslation>['t'] }) {
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      marginBottom: 6,
    }}>
      {attachments.map((att, idx) => {
        let icon: React.ReactNode;
        let label: string;

        switch (att.type) {
          case 'quote':
            icon = <Quote size={11} />;
            label = att.page != null
              ? t('context.chat.attachment.quotePage', { page: att.page, defaultValue: '引用 p.{{page}}' })
              : t('context.chat.attachment.quote', { defaultValue: '引用' });
            break;
          case 'image':
            icon = <ImageIcon size={11} />;
            label = (att.imageCount ?? 1) > 1
              ? t('context.chat.attachment.images', { count: att.imageCount, defaultValue: '{{count}} 张图片' })
              : t('context.chat.attachment.image', { defaultValue: '图片' });
            break;
          case 'writing-target':
            icon = att.targetKind === 'caret' ? <MapPin size={11} /> : <PenTool size={11} />;
            label = att.targetKind === 'caret'
              ? t('context.chat.attachment.caret', { defaultValue: '插入位置' })
              : t('context.chat.attachment.selection', { defaultValue: '选区' });
            break;
          default:
            return null;
        }

        return (
          <span
            key={idx}
            className="chat-bubble-attachment-chip"
            title={att.type === 'quote' && att.text ? att.text : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              fontSize: 11,
              lineHeight: 1,
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--accent-color) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-color) 14%, transparent)',
              color: 'var(--accent-color)',
              opacity: 0.78,
              whiteSpace: 'nowrap',
            }}
          >
            {icon}
            {label}
          </span>
        );
      })}
    </div>
  );
}

function ChatBubbleInner({ message, onRetry, onClarificationSelect, onApplyPatch, showAssistantLabel = false }: ChatBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const displayContent = message.status === 'streaming'
    ? (message.streamBuffer ?? message.content)
    : message.content;
  const thinkingContent = message.status === 'streaming'
    ? (message.thinkingBuffer ?? message.thinking)
    : message.thinking;

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
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentChips attachments={message.attachments} t={t} />
          )}
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
        {/* Thinking / 深度思考（可折叠） */}
        {thinkingContent && (
          <ThinkingBlock content={thinkingContent} streaming={message.status === 'streaming'} />
        )}

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

/** 可折叠的深度思考区块 */
function ThinkingBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(streaming);
  const { t } = useTranslation();

  return (
    <div style={{
      marginBottom: 14,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-sm, 6px)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 12px',
          border: 'none',
          background: 'color-mix(in srgb, var(--accent-color) 6%, var(--bg-base))',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        <Brain size={14} style={{ color: 'var(--accent-color)', opacity: 0.8 }} />
        <span>{t('context.chat.thinking', 'Thinking')}</span>
        {streaming && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: 'var(--accent-color)',
            animation: 'pulse 1.2s ease-in-out infinite',
            marginLeft: 2,
          }} />
        )}
        <ChevronRight
          size={14}
          style={{
            marginLeft: 'auto',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease',
            opacity: 0.5,
          }}
        />
      </button>
      {expanded && (
        <div style={{
          padding: '10px 14px',
          maxHeight: 320,
          overflowY: 'auto',
          color: 'var(--text-muted)',
          fontSize: '12px',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {content}
        </div>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </div>
  );
}

export const ChatBubble = React.memo(
  ChatBubbleInner,
  (prev, next) => {
    // 流式消息：比较流式缓冲区等变化字段
    if (next.message.status === 'streaming' || prev.message.status === 'streaming') {
      return prev.message.streamBuffer === next.message.streamBuffer
        && prev.message.thinkingBuffer === next.message.thinkingBuffer
        && prev.message.thinking === next.message.thinking
        && prev.message.status === next.message.status
        && prev.message.toolCalls === next.message.toolCalls;
    }
    // 状态变化需要重渲染（如 error → sending）
    if (prev.message.status !== next.message.status) return false;
    // pendingEditorPatches 变化需要重渲染
    if (prev.message.pendingEditorPatches !== next.message.pendingEditorPatches) return false;
    // 已完成消息完全静态化
    return prev.message.id === next.message.id
      && prev.message.content === next.message.content
      && prev.message.clarification === next.message.clarification
      && prev.message.attachments === next.message.attachments
      && prev.showAssistantLabel === next.showAssistantLabel;
  }
);
