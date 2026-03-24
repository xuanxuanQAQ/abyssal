/**
 * ChatHistory — 消息列表（§6.1、§6.4、§12.2）
 *
 * - ≤50 条消息：直接渲染
 * - >50 条消息：启用 @tanstack/react-virtual 虚拟化
 * - 自动滚动 + 拖拽防抖
 * - 未读消息浮动提示
 */

import React, { useRef, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { ChatBubble } from './ChatBubble';
import { useAutoScroll } from './hooks/useAutoScroll';
import type { ChatMessage } from '../../../../shared-types/models';

interface ChatHistoryProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  fullyLoaded: boolean;
  onLoadMore: () => void;
}

export function ChatHistory({
  messages,
  isStreaming,
  fullyLoaded,
  onLoadMore,
}: ChatHistoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isUserScrolledUp, unreadCount, handleScroll, scrollToBottom } =
    useAutoScroll(containerRef, messages.length, isStreaming);

  const handleScrollEvent = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      handleScroll();

      // 加载更多历史：滚到顶部时触发
      if (!fullyLoaded && (e.currentTarget as HTMLDivElement).scrollTop < 50) {
        onLoadMore();
      }
    },
    [handleScroll, fullyLoaded, onLoadMore]
  );

  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 加载更多历史 */}
      {!fullyLoaded && (
        <button
          onClick={onLoadMore}
          style={{
            padding: '4px 8px',
            margin: '4px auto',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
            background: 'none',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          加载更多历史消息
        </button>
      )}

      {/* 消息列表 */}
      <div
        ref={containerRef}
        onScroll={handleScrollEvent}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 0',
        }}
      >
        {/* TODO: messages.length > 50 时启用 @tanstack/react-virtual 虚拟化 */}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* 未读消息浮动提示 */}
      {isUserScrolledUp && unreadCount > 0 && (
        <button
          onClick={() => scrollToBottom()}
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 12px',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            zIndex: 1,
          }}
        >
          <ChevronDown size={12} />
          {unreadCount} 条新消息
        </button>
      )}
    </div>
  );
}
