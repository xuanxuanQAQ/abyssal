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
import { Clock, Check, AlertCircle } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';
import type { ChatMessage } from '../../../../shared-types/models';

interface ChatBubbleProps {
  message: ChatMessage;
  onRetry?: ((messageId: string) => void) | undefined;
}

function ChatBubbleInner({ message, onRetry }: ChatBubbleProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const displayContent = message.status === 'streaming'
    ? (message.streamBuffer ?? message.content)
    : message.content;

  const statusIcon = (() => {
    if (!isUser) return null;
    switch (message.status) {
      case 'sending':
        return <Clock size={10} style={{ color: 'var(--text-muted)' }} />;
      case 'sent':
        return <Check size={10} style={{ color: 'var(--text-muted)' }} />;
      case 'error':
        return <AlertCircle size={10} style={{ color: 'var(--danger)' }} />;
      default:
        return null;
    }
  })();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '3px 12px',
      }}
    >
      <div
        style={{
          maxWidth: isUser ? '82%' : '92%',
          padding: isUser ? '8px 14px' : '10px 14px',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          backgroundColor: isUser
            ? 'rgba(var(--accent-color-rgb, 59, 130, 246), 0.13)'
            : 'var(--bg-surface)',
          border:
            message.status === 'error'
              ? '1px solid var(--danger)'
              : isUser
                ? '1px solid rgba(var(--accent-color-rgb, 59, 130, 246), 0.2)'
                : '1px solid var(--border-subtle)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          position: 'relative',
          wordBreak: 'break-word',
        }}
      >
        {/* Tool Calls（在文本之前/之间渲染） */}
        {message.toolCalls?.map((tc, i) => (
          <ToolCallCard key={`${tc.name}-${i}`} toolCall={tc} />
        ))}

        {/* Markdown 内容 */}
        {displayContent && (
          <div className="chat-markdown">
            <Markdown remarkPlugins={[remarkGfm]}>
              {displayContent}
            </Markdown>
          </div>
        )}

        {/* 用户消息状态图标 */}
        {statusIcon && (
          <div
            style={{
              position: 'absolute',
              right: 4,
              bottom: 2,
            }}
          >
            {statusIcon}
          </div>
        )}

        {/* 错误状态重试按钮 */}
        {message.status === 'error' && onRetry && (
          <button
            onClick={() => onRetry(message.id)}
            style={{
              marginTop: 4,
              padding: '2px 8px',
              fontSize: 'var(--text-xs)',
              color: 'var(--danger)',
              background: 'none',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {t('context.chat.retry')}
          </button>
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
    // 已完成消息完全静态化
    return prev.message.id === next.message.id && prev.message.content === next.message.content;
  }
);
