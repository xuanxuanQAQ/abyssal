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
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock, Check, AlertCircle } from 'lucide-react';
import { ToolCallCard } from './ToolCallCard';
import type { ChatMessage } from '../../../../shared-types/models';

interface ChatBubbleProps {
  message: ChatMessage;
}

function ChatBubbleInner({ message }: ChatBubbleProps) {
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
        padding: '4px 12px',
      }}
    >
      <div
        style={{
          maxWidth: isUser ? '85%' : '92%',
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: isUser
            ? 'rgba(var(--accent-color-rgb, 59, 130, 246), 0.15)'
            : 'var(--bg-surface)',
          border:
            message.status === 'error'
              ? '1px solid var(--danger)'
              : '1px solid var(--border-subtle)',
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

        {/* 流式光标 */}
        {message.status === 'streaming' && (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              backgroundColor: 'var(--accent-color)',
              marginLeft: 2,
              animation: 'blink 1s step-end infinite',
              verticalAlign: 'text-bottom',
            }}
          />
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
        {message.status === 'error' && (
          <button
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
            重试
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
    // 已完成消息完全静态化
    return prev.message.id === next.message.id && prev.message.content === next.message.content;
  }
);
