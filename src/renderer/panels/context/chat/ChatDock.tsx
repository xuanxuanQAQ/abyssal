/**
 * ChatDock — 聊天容器（§1.2、§5）
 *
 * 固定布局：控制栏（顶部）→ 历史消息（中间，flex:1 滚动）→ 输入框（底部固定）
 * 输入框始终固定在底部不移动。
 *
 * 全屏模式：覆盖 ContextBody（由 ContextPanel 的 PanelGroup 驱动）。
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Bot, MessageSquare, Trash2 } from 'lucide-react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { useChatSession, persistMessage } from './hooks/useChatSession';
import { useChatContext } from './hooks/useChatContext';
import { useEffectiveSource } from '../engine/useEffectiveSource';
import { ChunkAccumulator } from './streaming/ChunkAccumulator';
import { useChatStore, type ChatDockMode } from '../../../core/store/useChatStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage } from '../../../../shared-types/models';
import type { AgentStreamEvent } from '../../../../shared-types/ipc';

export const ChatDock = React.memo(function ChatDock() {
  const { t } = useTranslation();
  const {
    sessionKey,
    messages,
    fullyLoaded,
    clearCurrentSession,
    loadMoreHistory,
  } = useChatSession();

  const chatStreaming = useChatStore((s) => s.chatStreaming);
  const chatDockMode = useChatStore((s) => s.chatDockMode);
  const setChatDockMode = useChatStore((s) => s.setChatDockMode);

  const source = useEffectiveSource();
  const buildChatContext = useChatContext();

  const accumulatorRef = useRef<ChunkAccumulator>(
    new ChunkAccumulator({
      onFinalize: (_messageId, content) => {
        const session = useChatStore.getState().sessions[sessionKey];
        const msg = session?.messages.find((m) => m.id === _messageId);
        if (msg) {
          persistMessage({ ...msg, content, status: 'completed' }, sessionKey);
        }
      },
    })
  );

  // Register agentStream listener ONCE.
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

      useChatStore.getState().ensureSession(sessionKey);
      useChatStore.getState().addMessage(userMessage);
      persistMessage({ ...userMessage, status: 'completed' }, sessionKey);
      // ChatContext still carries the context hint (which paper/concept is active)
      const chatContext = buildChatContext();

      try {
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
    [sessionKey, buildChatContext]
  );

  /** 重试失败的用户消息 */
  const handleRetry = useCallback(
    (messageId: string) => {
      const session = useChatStore.getState().sessions[sessionKey];
      const msg = session?.messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== 'user') return;
      handleSend(msg.content);
    },
    [sessionKey, handleSend]
  );

  const handleAbort = useCallback(() => {
    getAPI().chat.abort(sessionKey);
    accumulatorRef.current.finalize();
  }, [sessionKey]);

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
          {messages.length > 0 && (
            <button
              onClick={clearCurrentSession}
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
      </div>

      {/* 历史消息区域 */}
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

      {/* 输入框 */}
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
