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
import { Maximize2, Minimize2, Bot, MessageSquare, Plus, Trash2, Clock } from 'lucide-react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { ChatSessionHistory } from './ChatSessionHistory';
import { useChatSession, persistMessage } from './hooks/useChatSession';
import { useChatContext } from './hooks/useChatContext';
import { useEffectiveSource } from '../engine/useEffectiveSource';
import { ChunkAccumulator } from './streaming/ChunkAccumulator';
import { buildChatCopilotEnvelope, mapCopilotToolStatus } from './copilotBridge';
import { useChatStore, type ChatDockMode } from '../../../core/store/useChatStore';
import { useReaderStore } from '../../../core/store/useReaderStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage } from '../../../../shared-types/models';
import type { CopilotOperationEvent, CopilotSessionState } from '../../../../copilot-runtime/types';

interface OperationBinding {
  messageId: string;
  sessionKey: string;
}

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
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const {
    sessionKey,
    messages,
    fullyLoaded,
    createNewSession,
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

  const accumulatorsRef = useRef<Map<string, ChunkAccumulator>>(new Map());
  const operationBindingsRef = useRef<Map<string, OperationBinding>>(new Map());
  const pendingCopilotEventsRef = useRef<Map<string, CopilotOperationEvent[]>>(new Map());
  const sessionOperationRef = useRef<Map<string, string>>(new Map());

  const getOrCreateAccumulator = useCallback((operationId: string, messageId: string, targetSessionKey: string) => {
    let accumulator = accumulatorsRef.current.get(operationId);
    if (!accumulator) {
      accumulator = new ChunkAccumulator({
        onFinalize: (_messageId, content, finalizedSessionKey) => {
          const session = useChatStore.getState().sessions[finalizedSessionKey];
          const msg = session?.messages.find((m) => m.id === _messageId);
          if (msg) {
            persistMessage({ ...msg, content, status: 'completed' }, finalizedSessionKey);
          }
        },
      });
      accumulatorsRef.current.set(operationId, accumulator);
    }

    accumulator.bind(messageId, targetSessionKey);
    return accumulator;
  }, []);

  const clearOperationState = useCallback((operationId: string, clearSessionBinding = true) => {
    const binding = operationBindingsRef.current.get(operationId);
    operationBindingsRef.current.delete(operationId);
    pendingCopilotEventsRef.current.delete(operationId);

    const accumulator = accumulatorsRef.current.get(operationId);
    if (accumulator) {
      accumulator.dispose();
      accumulatorsRef.current.delete(operationId);
    }

    if (clearSessionBinding && binding) {
      const activeOperationId = sessionOperationRef.current.get(binding.sessionKey);
      if (activeOperationId === operationId) {
        sessionOperationRef.current.delete(binding.sessionKey);
      }
    }
  }, []);

  const finalizeOperation = useCallback((operationId: string, clearSessionBinding = true) => {
    const accumulator = accumulatorsRef.current.get(operationId);
    if (accumulator) {
      accumulator.finalize();
    }
    clearOperationState(operationId, clearSessionBinding);
  }, [clearOperationState]);

  const finalizeSessionOperations = useCallback((targetSessionKey: string, clearSessionBinding = true) => {
    for (const [operationId, binding] of operationBindingsRef.current.entries()) {
      if (binding.sessionKey === targetSessionKey) {
        finalizeOperation(operationId, clearSessionBinding);
      }
    }
  }, [finalizeOperation]);

  const syncPendingClarification = useCallback(async (targetSessionKey: string) => {
    const session = await getAPI().copilot.getSession(targetSessionKey) as CopilotSessionState | null;
    const clarification = session?.pendingClarification;
    if (!clarification) return;

    sessionOperationRef.current.set(targetSessionKey, clarification.operationId);
    finalizeSessionOperations(targetSessionKey, false);

    useChatStore.getState().ensureSession(targetSessionKey);
    const cachedSession = useChatStore.getState().sessions[targetSessionKey];
    const lastAssistantMessage = [...(cachedSession?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant');

    const clarificationState = {
      operationId: clarification.operationId,
      continuationToken: clarification.continuationToken,
      question: clarification.question,
      options: clarification.options.map((option) => ({ id: option.id, label: option.label })),
    };

    if (!lastAssistantMessage) {
      useChatStore.getState().addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: clarification.question,
        timestamp: Date.now(),
        status: 'completed',
        clarification: clarificationState,
      });
      useChatStore.getState().setChatStreaming(false);
      return;
    }

    useChatStore.getState().updateMessageInSession(targetSessionKey, lastAssistantMessage.id, (message) => {
      if (!message.content) {
        message.content = clarification.question;
      }
      message.status = 'completed';
      delete message.streamBuffer;
      message.clarification = clarificationState;
    });
    useChatStore.getState().setChatStreaming(false);
  }, [finalizeSessionOperations]);

  const handleCopilotEvent = useCallback((event: CopilotOperationEvent) => {
    if (event.type === 'operation.started') {
      sessionOperationRef.current.set(event.sessionId, event.operationId);
    }

    const binding = operationBindingsRef.current.get(event.operationId);
    if (!binding) {
      const buffered = pendingCopilotEventsRef.current.get(event.operationId) ?? [];
      pendingCopilotEventsRef.current.set(event.operationId, [...buffered, event]);
      return;
    }

    const accumulator = getOrCreateAccumulator(event.operationId, binding.messageId, binding.sessionKey);

    switch (event.type) {
      case 'model.delta':
        if (event.channel === 'chat') {
          accumulator.pushChunk(event.text);
        }
        break;

      case 'tool.call':
        accumulator.pushToolCall({
          name: event.toolName,
          input: {},
          ...(event.message ? { output: event.message } : {}),
          status: mapCopilotToolStatus(event.status),
        });
        break;

      case 'operation.completed':
        finalizeOperation(event.operationId);
        break;

      case 'operation.failed':
        accumulator.pushChunk(`\n\n**Error:** ${event.message}`);
        finalizeOperation(event.operationId);
        break;

      case 'operation.aborted':
        finalizeOperation(event.operationId);
        break;

      case 'operation.clarification_required':
        finalizeOperation(event.operationId, false);
        void syncPendingClarification(binding.sessionKey);
        break;

      default:
        break;
    }
  }, [finalizeOperation, getOrCreateAccumulator, syncPendingClarification]);

  const flushPendingCopilotEvents = useCallback((operationId: string) => {
    const pending = pendingCopilotEventsRef.current.get(operationId) ?? [];
    pendingCopilotEventsRef.current.delete(operationId);
    for (const event of pending) {
      handleCopilotEvent(event);
    }
  }, [handleCopilotEvent]);

  const registerOperationBinding = useCallback((operationId: string, messageId: string, targetSessionKey: string) => {
    operationBindingsRef.current.set(operationId, { messageId, sessionKey: targetSessionKey });
    sessionOperationRef.current.set(targetSessionKey, operationId);
    getOrCreateAccumulator(operationId, messageId, targetSessionKey);
    flushPendingCopilotEvents(operationId);
  }, [flushPendingCopilotEvents, getOrCreateAccumulator]);

  const rebindOperation = useCallback((previousOperationId: string, nextOperationId: string) => {
    if (previousOperationId === nextOperationId) {
      flushPendingCopilotEvents(nextOperationId);
      return;
    }

    const binding = operationBindingsRef.current.get(previousOperationId);
    if (binding) {
      operationBindingsRef.current.delete(previousOperationId);
      operationBindingsRef.current.set(nextOperationId, binding);

      const accumulator = accumulatorsRef.current.get(previousOperationId);
      if (accumulator) {
        accumulatorsRef.current.delete(previousOperationId);
        accumulatorsRef.current.set(nextOperationId, accumulator);
        accumulator.bind(binding.messageId, binding.sessionKey);
      }

      if (sessionOperationRef.current.get(binding.sessionKey) === previousOperationId) {
        sessionOperationRef.current.set(binding.sessionKey, nextOperationId);
      }
    }

    pendingCopilotEventsRef.current.delete(previousOperationId);
    flushPendingCopilotEvents(nextOperationId);
  }, [flushPendingCopilotEvents]);

  useEffect(() => {
    const api = getAPI();
    const unsub = api.on.copilotEvent((event) => {
      handleCopilotEvent(event as CopilotOperationEvent);
    });

    return () => {
      unsub();
      for (const accumulator of accumulatorsRef.current.values()) {
        accumulator.dispose();
      }
      accumulatorsRef.current.clear();
      operationBindingsRef.current.clear();
      pendingCopilotEventsRef.current.clear();
      sessionOperationRef.current.clear();
    };
  }, [handleCopilotEvent]);

  useEffect(() => {
    const api = getAPI();
    void syncPendingClarification(sessionKey);
    const unsub = api.on.copilotSessionChanged((event) => {
      if (event.sessionId !== sessionKey) return;
      void syncPendingClarification(sessionKey);
    });
    return () => {
      unsub();
    };
  }, [sessionKey, syncPendingClarification]);

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
      const chatContext = {
        ...buildChatContext(),
        conversationKey: sessionKey,
      };

      try {
        const envelope = buildChatCopilotEnvelope(sessionKey, text, chatContext);
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
        registerOperationBinding(envelope.operation.id, assistantMessage.id, sessionKey);

        const result = await getAPI().copilot.execute(envelope);
        rebindOperation(envelope.operation.id, result.operationId);
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'sent';
        });
      } catch (err) {
        const errorMessage = (err as Error).message ?? 'Send failed';
        useChatStore.getState().updateMessage(userMessage.id, (msg) => {
          msg.status = 'error';
        });
        const assistantOperationId = sessionOperationRef.current.get(sessionKey);
        if (assistantOperationId) {
          const binding = operationBindingsRef.current.get(assistantOperationId);
          const accumulator = binding
            ? getOrCreateAccumulator(assistantOperationId, binding.messageId, binding.sessionKey)
            : null;
          if (accumulator) {
            accumulator.pushChunk(`**Error:** ${errorMessage}`);
            finalizeOperation(assistantOperationId);
          }
        }
        useChatStore.getState().setChatStreaming(false);
      } finally {
        sendingRef.current = false;
      }
    },
    [buildChatContext, finalizeOperation, getOrCreateAccumulator, registerOperationBinding, rebindOperation, sessionKey]
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
    const operationId = sessionOperationRef.current.get(sessionKey);
    if (operationId) {
      void getAPI().copilot.abort(operationId);
      finalizeOperation(operationId);
    }
  }, [finalizeOperation, sessionKey]);

  const handleClarificationSelect = useCallback(async (messageId: string, optionId: string) => {
    const session = useChatStore.getState().sessions[sessionKey];
    const message = session?.messages.find((entry) => entry.id === messageId);
    const clarification = message?.clarification;
    if (!clarification || clarification.submitting) return;

    useChatStore.getState().updateMessageInSession(sessionKey, messageId, (entry) => {
      if (!entry.clarification) return;
      entry.clarification = {
        ...entry.clarification,
        submitting: true,
        selectedOptionId: optionId,
      };
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
    registerOperationBinding(clarification.operationId, assistantMessage.id, sessionKey);

    try {
      const result = await getAPI().copilot.resume({
        operationId: clarification.operationId,
        continuationToken: clarification.continuationToken,
        selectedOptionId: optionId,
      });
      rebindOperation(clarification.operationId, result.operationId);
    } catch (err) {
      const errorMessage = (err as Error).message ?? 'Resume failed';
      clearOperationState(clarification.operationId, false);
      useChatStore.getState().updateMessageInSession(sessionKey, assistantMessage.id, (entry) => {
        entry.content = `**Error:** ${errorMessage}`;
        entry.status = 'completed';
        delete entry.streamBuffer;
      });
      persistMessage({ ...assistantMessage, content: `**Error:** ${errorMessage}`, status: 'completed' }, sessionKey);
      useChatStore.getState().updateMessageInSession(sessionKey, messageId, (entry) => {
        if (!entry.clarification) return;
        entry.clarification = {
          ...entry.clarification,
          submitting: false,
          selectedOptionId: undefined,
        };
      });
    }
  }, [clearOperationState, registerOperationBinding, rebindOperation, sessionKey]);

  const toggleFullscreen = useCallback(() => {
    const newMode: ChatDockMode = chatDockMode === 'fullscreen' ? 'expanded' : 'fullscreen';
    setChatDockMode(newMode);
  }, [chatDockMode, setChatDockMode]);

  const handleCreateNewSession = useCallback(() => {
    createNewSession();
    setIsHistoryExpanded(false);
  }, [createNewSession]);

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
        <div className="chat-dock-toolbar-leading" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          <button
            onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
            className="chat-dock-toolbar-btn"
            style={{
              background: 'transparent',
              border: 'none',
              color: isHistoryExpanded ? 'var(--accent-color)' : 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => !isHistoryExpanded && (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => !isHistoryExpanded && (e.currentTarget.style.color = 'var(--text-muted)')}
            title={t('context.chat.sessionHistory')}
          >
            <Clock size={14} />
          </button>
        </div>
        <div className="chat-dock-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleCreateNewSession}
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
            title={t('context.chat.newSession')}
          >
            <Plus size={14} />
          </button>
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

      {/* 会话历史列表（可展开） */}
      {isHistoryExpanded && (
        <ChatSessionHistory onSessionSelected={() => setIsHistoryExpanded(false)} />
      )}

      {/* 历史消息区域 */}
      <div className="chat-dock-history-stage" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>
        {messages.length > 0 ? (
          <ChatHistory
            messages={messages}
            isStreaming={chatStreaming}
            fullyLoaded={fullyLoaded}
            onLoadMore={loadMoreHistory}
            onRetry={handleRetry}
            onClarificationSelect={handleClarificationSelect}
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
