/**
 * ChatHistory — 消息列表（§6.1、§6.4、§12.2）
 *
 * - ≤50 条消息：直接渲染
 * - >50 条消息：启用 @tanstack/react-virtual 虚拟化
 * - 自动滚动 + 拖拽防抖
 * - 未读消息浮动提示
 */

import React, { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import { ChatBubble } from './ChatBubble';
import { useAutoScroll } from './hooks/useAutoScroll';
import type { ChatMessage } from '../../../../shared-types/models';

/** 虚拟化阈值：超过此数量启用虚拟滚动 */
const VIRTUALIZE_THRESHOLD = 50;

interface ChatHistoryProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  fullyLoaded: boolean;
  onLoadMore: () => void;
  onRetry?: (messageId: string) => void;
  bottomInset?: number;
}

export const ChatHistory = React.memo(function ChatHistory({
  messages,
  isStreaming,
  fullyLoaded,
  onLoadMore,
  onRetry,
  bottomInset = 112,
}: ChatHistoryProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { isUserScrolledUp, unreadCount, handleScroll, scrollToBottom } =
    useAutoScroll(containerRef, messages.length, isStreaming);
  const firstAssistantId = messages.find((message) => message.role === 'assistant')?.id;

  const useVirtual = messages.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 72,
    overscan: 8,
    enabled: useVirtual,
  });

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
      className="chat-history-shell"
      style={{
        flex: 1,
        height: '100%',
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
          className="chat-history-load-more"
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
          {t('context.chat.loadMore')}
        </button>
      )}

      {/* 消息列表 */}
      <div
        ref={containerRef}
        onScroll={handleScrollEvent}
        className="chat-scroll-area custom-scrollbar chat-history-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'scroll',
          overflowX: 'hidden',
          padding: `18px 0 ${bottomInset}px`,
        }}
      >
        {useVirtual ? (
          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index]!;
              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingBottom: 16,
                  }}
                >
                  <ChatBubble message={msg} onRetry={onRetry} showAssistantLabel={msg.id === firstAssistantId} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="chat-history-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 24px' }}>
            {messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} onRetry={onRetry} showAssistantLabel={msg.id === firstAssistantId} />
            ))}
          </div>
        )}
      </div>

      {/* 未读消息浮动提示 */}
      {isUserScrolledUp && unreadCount > 0 && (
        <button
          onClick={() => scrollToBottom()}
          className="chat-history-unread-btn"
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
          {t('context.chat.newMessages', { count: unreadCount })}
        </button>
      )}
    </div>
  );
});
