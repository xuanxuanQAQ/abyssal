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
import { useReaderStore } from '../../../core/store/useReaderStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage } from '../../../../shared-types/models';
import type { AgentStreamEvent } from '../../../../shared-types/ipc';

function getToolDisplayLabel(
  toolName: string,
  t: ReturnType<typeof import('react-i18next').useTranslation>['t'],
): string {
  const i18nKey = `context.chat.toolCall.tools.${toolName.replace('--', '.')}`;
  const translated = t(i18nKey);
  if (translated !== i18nKey) return translated;

  const parts = toolName.split('--');
  const operation = (parts.length > 1 ? parts[1] : parts[0]) ?? toolName;
  return operation
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

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
  const quotedSelection = useReaderStore((s) => s.quotedSelection);
  const selectionPayload = useReaderStore((s) => s.selectionPayload);

  const source = useEffectiveSource();
  const buildChatContext = useChatContext();
  const hasSelectionMapping = Boolean(quotedSelection || selectionPayload?.images?.length || selectionPayload?.text);
  const historyBottomInset = hasSelectionMapping ? 196 : 118;
  const streamingAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'streaming');
  const activeToolCalls = (streamingAssistantMessage?.toolCalls ?? []).filter(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'pending',
  );
  const toolStatusText = activeToolCalls.length === 1
    ? t('context.chat.status.invokingTool', {
      tool: getToolDisplayLabel(activeToolCalls[0]!.name, t),
    })
    : activeToolCalls.length > 1
      ? t('context.chat.status.invokingTools', { count: activeToolCalls.length })
      : t('context.chat.status.generating');
  const toolStatusMode = activeToolCalls.length > 0 ? 'tool' : 'generating';

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
      className="chat-dock-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        backgroundColor: 'transparent',
        overflow: 'hidden',
      }}
    >
      {/* 控制栏 */}
      <div
        className="chat-dock-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          flexShrink: 0,
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'color-mix(in srgb, var(--lens-surface) 80%, transparent)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div className="chat-dock-toolbar-leading" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: 18, 
            height: 18, 
            borderRadius: 4,
          }}>
            <Bot size={14} style={{ color: 'var(--accent-color)' }} />
          </div>
        </div>
        <div className="chat-dock-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {messages.length > 0 && (
            <button
              onClick={clearCurrentSession}
              className="chat-dock-toolbar-btn"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                transition: 'color 150ms ease',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              title={t('context.chat.clearSession')}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className="chat-dock-toolbar-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            title={chatDockMode === 'fullscreen' ? t('context.chat.restore') : t('context.chat.maximize')}
          >
            {chatDockMode === 'fullscreen' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* 历史消息区域 */}
      <div className="chat-dock-history-stage" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
        {messages.length > 0 ? (
          <ChatHistory
            messages={messages}
            isStreaming={chatStreaming}
            fullyLoaded={fullyLoaded}
            onLoadMore={loadMoreHistory}
            onRetry={handleRetry}
            bottomInset={historyBottomInset}
          />
        ) : (
          <div className="chat-dock-empty-state" style={{
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
        <div className="chat-dock-input-veil" />
      </div>

      {/* 输入框 */}
      <div className="chat-dock-input-overlay" style={{ position: 'absolute', left: 16, right: 16, bottom: 18, zIndex: 3, pointerEvents: 'none' }}>
        <div className="chat-dock-input-frame" style={{
          boxShadow: chatStreaming
            ? '0 20px 40px rgba(59, 130, 246, 0.12), 0 8px 18px rgba(15, 23, 42, 0.08)'
            : '0 16px 36px rgba(15, 23, 42, 0.10), 0 6px 14px rgba(15, 23, 42, 0.05)',
          borderRadius: 24,
          background: 'color-mix(in srgb, var(--lens-surface-strong) 92%, transparent)',
          border: '1px solid var(--lens-border)',
          backdropFilter: 'blur(24px) saturate(1.08)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.08)',
          pointerEvents: 'auto',
        }}>
          <ChatInput
            source={source}
            onSend={handleSend}
            onAbort={handleAbort}
            streaming={chatStreaming}
            statusText={chatStreaming ? toolStatusText : undefined}
            statusMode={toolStatusMode}
          />
        </div>
      </div>
    </div>
  );
});
