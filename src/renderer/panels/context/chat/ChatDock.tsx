/**
 * ChatDock — 聊天容器（§1.2、§5）
 *
 * 固定布局：控制栏（顶部）→ 历史消息（中间，flex:1 滚动）→ 输入框（底部固定）
 * 输入框始终固定在底部不移动。
 *
 * 全屏模式：覆盖 ContextBody（由 ContextPanel 的 PanelGroup 驱动）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Bot, MessageSquare, History, Plus, Trash2 } from 'lucide-react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { ChatSessionList } from './ChatSessionList';
import { useChatSession, persistMessage } from './hooks/useChatSession';
import { useChatContext } from './hooks/useChatContext';
import { ChunkAccumulator } from './streaming/ChunkAccumulator';
import { useChatStore, type ChatDockMode } from '../../../core/store/useChatStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage } from '../../../../shared-types/models';
import type { AgentStreamEvent } from '../../../../shared-types/ipc';

export const ChatDock = React.memo(function ChatDock() {
  const { t } = useTranslation();
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

  // Register agentStream listener ONCE (not per contextKey).
  // Events carry their own conversationId — no need to re-register on context change.
  useEffect(() => {
    const api = getAPI();
    const unsub = api.on.agentStream((event: AgentStreamEvent) => {
      const accumulator = accumulatorRef.current;

      switch (event.type) {
        case 'text_delta':
          accumulator.pushChunk(event.delta);
          break;

        case 'tool_use_start':
          accumulator.pushToolCall({
            name: event.toolName,
            input: event.args,
            status: 'running',
          });
          break;

        case 'tool_use_result':
          accumulator.pushToolCall({
            name: event.toolName,
            input: {},
            output: event.result,
            status: 'completed',
          });
          break;

        case 'done':
          accumulator.finalize();
          break;

        case 'error':
          // Show error as assistant message content
          accumulator.pushChunk(`\n\n**Error:** ${event.message}`);
          accumulator.finalize();
          break;
      }
    });

    return () => {
      unsub();
      accumulatorRef.current.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 发送去重：防止快速连点产生重复消息
  const sendingRef = useRef(false);

  const handleSend = useCallback(
    async (text: string) => {
      if (sendingRef.current) return;
      sendingRef.current = true;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        status: 'sending',
      };

      // Ensure session exists before adding messages
      useChatStore.getState().ensureSession(contextKey);
      useChatStore.getState().addMessage(userMessage);
      persistMessage({ ...userMessage, status: 'completed' }, contextKey);
      const chatContext = buildChatContext();

      try {
        // Create assistant placeholder before sending, so streaming has a target
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

        await getAPI().chat.send(text, chatContext);
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'sent';
        });
      } catch {
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'error';
        });
        useChatStore.getState().setChatStreaming(false);
      } finally {
        sendingRef.current = false;
      }
    },
    [contextKey, buildChatContext]
  );

  /** 重试失败的用户消息 */
  const handleRetry = useCallback(
    (messageId: string) => {
      const session = useChatStore.getState().sessions[contextKey];
      const msg = session?.messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== 'user') return;
      handleSend(msg.content);
    },
    [contextKey, handleSend]
  );

  const [showSessionList, setShowSessionList] = useState(false);

  const handleSessionSelect = useCallback((selectedKey: string) => {
    // Switch to selected session by updating store directly
    useChatStore.getState().ensureSession(selectedKey);
    useChatStore.getState().setActiveSessionKey(selectedKey);
    // Load from DB if hot cache is empty
    getAPI().db.chat.getHistory(selectedKey, { limit: 50 }).then((records) => {
      const cached = useChatStore.getState().sessions[selectedKey];
      if (cached && cached.messages.length === 0 && records.length > 0) {
        const msgs = records.map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content,
          timestamp: r.timestamp,
          status: 'completed' as const,
          toolCalls: r.toolCalls ? JSON.parse(r.toolCalls) : undefined,
          citations: r.citations ? JSON.parse(r.citations) : undefined,
        }));
        useChatStore.getState().loadSessionMessages(selectedKey, msgs, msgs.length < 50);
      }
    }).catch((err: unknown) => {
      console.warn('[ChatDock] Failed to load session history:', err);
    });
  }, []);

  const handleAbort = useCallback(() => {
    getAPI().chat.abort(contextKey);
    // Finalize the current streaming message
    accumulatorRef.current.finalize();
  }, [contextKey]);

  const handleNewSession = useCallback(() => {
    const newKey = `global:${Date.now()}`;
    useChatStore.getState().ensureSession(newKey);
    useChatStore.getState().setActiveSessionKey(newKey);
  }, []);

  const handleClearSession = clearCurrentSession;

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
          position: 'relative',
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
            {t('context.chat.title')}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            onClick={handleNewSession}
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
            title={t('context.chat.newSession')}
          >
            <Plus size={13} />
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClearSession}
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
              title={t('context.chat.clearSession')}
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={() => setShowSessionList((v) => !v)}
            style={{
              background: showSessionList ? 'var(--bg-surface)' : 'none',
              border: 'none',
              color: showSessionList ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 100ms ease',
            }}
            title={t('context.chat.historySessions')}
          >
            <History size={13} />
          </button>
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
            title={chatDockMode === 'fullscreen' ? t('context.chat.restore') : t('context.chat.maximize')}
          >
            {chatDockMode === 'fullscreen' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>

        {/* 历史会话下拉列表 */}
        {showSessionList && (
          <ChatSessionList
            currentKey={contextKey}
            onSelect={handleSessionSelect}
            onClose={() => setShowSessionList(false)}
          />
        )}
      </div>

      {/* 历史消息区域 — 始终可见，flex:1 填充中间 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {messages.length > 0 ? (
          <ChatHistory
            messages={messages}
            isStreaming={chatStreaming}
            fullyLoaded={fullyLoaded}
            onLoadMore={loadMoreHistory}
            onRetry={handleRetry}
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
            <span style={{ fontSize: 12 }}>{t('context.chat.empty')}</span>
          </div>
        )}
      </div>

      {/* 输入框 — 固定在底部 */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)' }}>
        <ChatInput
          source={source}
          onSend={handleSend}
          onAbort={handleAbort}
          streaming={chatStreaming}
        />
      </div>
    </div>
  );
});
