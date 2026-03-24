/**
 * ChatDock — 聊天容器（§1.2、§5）
 *
 * 固定布局：控制栏（顶部）→ 历史消息（中间，flex:1 滚动）→ 输入框（底部固定）
 * 输入框始终固定在底部不移动。
 *
 * 全屏模式：覆盖 ContextBody（由 ContextPanel 的 PanelGroup 驱动）。
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, Bot, MessageSquare } from 'lucide-react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { useChatSession, persistMessage } from './hooks/useChatSession';
import { useChatContext } from './hooks/useChatContext';
import { ChunkAccumulator } from './streaming/ChunkAccumulator';
import { useChatStore, type ChatDockMode } from '../../../core/store/useChatStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage } from '../../../../shared-types/models';
import type { ChatResponseEvent } from '../../../../shared-types/ipc';

export function ChatDock() {
  const {
    contextKey,
    messages,
    fullyLoaded,
    clearCurrentSession,
    loadMoreHistory,
    source,
  } = useChatSession();

  const chatStreaming = useChatStore((s) => s.chatStreaming);
  const chatDockMode = useChatStore((s) => s.chatDockMode);
  const setChatDockMode = useChatStore((s) => s.setChatDockMode);

  const buildChatContext = useChatContext();

  // 用 ref 追踪最新 contextKey，避免 ChunkAccumulator 闭包捕获过时值
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const accumulatorRef = useRef<ChunkAccumulator>(
    new ChunkAccumulator({
      onFinalize: (_messageId, content) => {
        const currentKey = contextKeyRef.current;
        const session = useChatStore.getState().sessions[currentKey];
        const msg = session?.messages.find((m) => m.id === _messageId);
        if (msg) {
          persistMessage({ ...msg, content, status: 'completed' }, currentKey);
        }
      },
    })
  );

  useEffect(() => {
    const api = getAPI();
    const unsub = api.chat.onResponse((event: ChatResponseEvent) => {
      const accumulator = accumulatorRef.current;
      if (event.chunk) {
        accumulator.pushChunk(event.chunk);
      }
      if (event.toolCalls) {
        for (const tc of event.toolCalls) {
          accumulator.pushToolCall({
            name: tc.name,
            input: tc.input,
            ...(tc.output !== undefined ? { output: tc.output } : {}),
            status: 'completed',
          });
        }
      }
      if (event.isLast) {
        accumulator.finalize();
      }
    });

    return () => {
      unsub();
      accumulatorRef.current.dispose();
    };
  }, [contextKey]);

  const handleSend = useCallback(
    async (text: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        status: 'sending',
      };

      useChatStore.getState().addMessage(userMessage);
      persistMessage({ ...userMessage, status: 'completed' }, contextKey);
      const chatContext = buildChatContext();

      try {
        await getAPI().chat.send(text, chatContext);
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'sent';
        });

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          status: 'streaming',
          streamBuffer: '',
        };

        useChatStore.getState().addMessage(assistantMessage);
        useChatStore.getState().setChatStreaming(true);
        accumulatorRef.current.bind(assistantMessage.id);
      } catch {
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'error';
        });
      }
    },
    [contextKey, buildChatContext]
  );

  const toggleFullscreen = useCallback(() => {
    const newMode: ChatDockMode = chatDockMode === 'fullscreen' ? 'expanded' : 'fullscreen';
    setChatDockMode(newMode);
  }, [chatDockMode, setChatDockMode]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-surface-low)',
      }}
    >
      {/* 控制栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bot size={14} style={{ color: 'var(--accent-color)', opacity: 0.8 }} />
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
          }}>
            AI 聊天
          </span>
          {messages.length > 0 && (
            <span style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-surface)',
              padding: '1px 6px',
              borderRadius: 10,
              fontWeight: 500,
            }}>
              {messages.length}
            </span>
          )}
        </div>
        <button
          onClick={toggleFullscreen}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            transition: 'color 100ms ease',
          }}
          title={chatDockMode === 'fullscreen' ? '还原' : '最大化'}
        >
          {chatDockMode === 'fullscreen' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      {/* 历史消息区域 — 始终可见，flex:1 填充中间 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {messages.length > 0 ? (
          <ChatHistory
            messages={messages}
            isStreaming={chatStreaming}
            fullyLoaded={fullyLoaded}
            onLoadMore={loadMoreHistory}
          />
        ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--text-muted)',
            opacity: 0.5,
          }}>
            <MessageSquare size={24} />
            <span style={{ fontSize: 12 }}>暂无对话</span>
          </div>
        )}
      </div>

      {/* 输入框 — 固定在底部 */}
      <ChatInput
        source={source}
        onSend={handleSend}
        disabled={chatStreaming}
      />
    </div>
  );
}
