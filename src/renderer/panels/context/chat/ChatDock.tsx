/**
 * ChatDock — 聊天容器（§1.2、§5）
 *
 * 固定布局：控制栏（顶部）→ 历史消息（中间，flex:1 滚动）→ 输入框（底部固定）
 * 输入框始终固定在底部不移动。
 *
 * 全屏模式：覆盖 ContextBody（由 ContextPanel 的 PanelGroup 驱动）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useEditorStore } from '../../../core/store/useEditorStore';
import { getAPI } from '../../../core/ipc/bridge';
import type { ChatMessage, MessageAttachment } from '../../../../shared-types/models';
import { useReaderStore } from '../../../core/store/useReaderStore';
import type { CopilotOperationEvent, CopilotSessionState } from '../../../../copilot-runtime/types';

interface OperationBinding {
  messageId: string;
  sessionKey: string;
  intent?: string;
}

/** Short status notes shown in chat for operations that don't produce chat text. */
const DRAFT_INTENT_LABELS: Record<string, string> = {
  'rewrite-selection': '✎ 已在编辑器中改写选区',
  'expand-selection': '✎ 已在编辑器中扩展选区',
  'compress-selection': '✎ 已在编辑器中压缩选区',
  'continue-writing': '✎ 已在编辑器中续写',
  'generate-section': '✎ 已生成章节内容',
  'navigate': '↗ 已跳转到目标视图',
  'run-workflow': '⚙ 工作流已启动',
};

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

/** 从当前 store 状态快照收集附件元数据 */
function collectAttachments(): MessageAttachment[] | undefined {
  const readerState = useReaderStore.getState();
  const editorState = useEditorStore.getState();
  const attachments: MessageAttachment[] = [];

  // 引用文本
  const quote = readerState.quotedSelection;
  const payload = readerState.selectionPayload;
  const text = quote?.text ?? payload?.text;
  if (text) {
    attachments.push({
      type: 'quote',
      text,
      page: quote?.page ?? payload?.sourcePages?.[0],
    });
  }

  // DLA 图片
  if (payload?.images?.length) {
    attachments.push({
      type: 'image',
      imageCount: payload.images.length,
      imageTypes: [...new Set(payload.images.map((img) => img.type))],
      page: payload.sourcePages?.[0],
    });
  }

  // 写作选区 / 光标锚点
  const wt = editorState.persistedWritingTarget;
  if (wt) {
    attachments.push({
      type: 'writing-target',
      targetKind: wt.kind,
      selectedText: wt.kind === 'range' ? wt.selectedText : undefined,
    });
  }

  return attachments.length > 0 ? attachments : undefined;
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
  const source = useEffectiveSource();
  const buildChatContext = useChatContext();

  // Dynamically measure the input overlay height so the chat history
  // bottom padding always matches the actual input bar size.
  const inputFrameRef = useRef<HTMLDivElement>(null);
  const [historyBottomInset, setHistoryBottomInset] = useState(118);
  useEffect(() => {
    const el = inputFrameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // input overlay is positioned at bottom: 18px, add a small gap (12px)
      const inset = Math.ceil(entry.contentRect.height) + 18 + 12;
      setHistoryBottomInset(inset);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Track the pipeline phase of the active operation for status display.
  type OperationPhase = 'preparing' | 'planning' | 'retrieving' | 'generating';
  const [operationPhase, setOperationPhase] = useState<OperationPhase>('preparing');

  const streamingAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.status === 'streaming');
  const activeToolCalls = (streamingAssistantMessage?.toolCalls ?? []).filter(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'pending',
  );

  // Derive status text from tool calls (highest priority) → operation phase.
  const { statusText: derivedStatusText, statusMode: derivedStatusMode } = useMemo(() => {
    if (activeToolCalls.length === 1) {
      return {
        statusText: t('context.chat.status.invokingTool', {
          tool: getToolDisplayLabel(activeToolCalls[0]!.name, t),
        }),
        statusMode: 'tool' as const,
      };
    }
    if (activeToolCalls.length > 1) {
      return {
        statusText: t('context.chat.status.invokingTools', { count: activeToolCalls.length }),
        statusMode: 'tool' as const,
      };
    }
    // No active tool calls — show pipeline phase.
    const phaseStatusMap: Record<OperationPhase, string> = {
      preparing: t('context.chat.status.preparing'),
      planning: t('context.chat.status.planning'),
      retrieving: t('context.chat.status.retrieving'),
      generating: t('context.chat.status.generating'),
    };
    return {
      statusText: phaseStatusMap[operationPhase],
      statusMode: 'generating' as const,
    };
  }, [activeToolCalls, operationPhase, t]);

  const accumulatorsRef = useRef<Map<string, ChunkAccumulator>>(new Map());
  const operationBindingsRef = useRef<Map<string, OperationBinding>>(new Map());
  const pendingCopilotEventsRef = useRef<Map<string, CopilotOperationEvent[]>>(new Map());
  const sessionOperationRef = useRef<Map<string, string>>(new Map());

  // RAF-throttled draft stream buffer to avoid "Maximum update depth exceeded"
  // when draft deltas arrive faster than React can render.
  const draftBufferRef = useRef('');
  const draftRafRef = useRef<number | null>(null);
  const flushDraftBuffer = useCallback(() => {
    if (draftBufferRef.current) {
      useEditorStore.getState().appendDraftStreamText(draftBufferRef.current);
      draftBufferRef.current = '';
    }
    draftRafRef.current = null;
  }, []);
  const scheduleDraftFlush = useCallback((chunk: string) => {
    draftBufferRef.current += chunk;
    if (draftRafRef.current === null) {
      draftRafRef.current = requestAnimationFrame(flushDraftBuffer);
    }
  }, [flushDraftBuffer]);

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
      setOperationPhase('preparing');
      // Backfill routed intent into binding (covers handleSend which doesn't pass intent)
      const existingBinding = operationBindingsRef.current.get(event.operationId);
      if (existingBinding && !existingBinding.intent && event.intent) {
        existingBinding.intent = event.intent;
      }
    }

    // Update operation phase based on lifecycle events.
    // These fire before the binding may exist, so handle them unconditionally.
    switch (event.type) {
      case 'context.resolved':
        setOperationPhase('planning');
        break;
      case 'planning.finished':
        // Stay on 'planning' — will transition to 'retrieving' or 'generating'
        break;
      case 'retrieval.started':
        setOperationPhase('retrieving');
        break;
      case 'retrieval.finished':
        setOperationPhase('generating');
        break;
      case 'model.thinking_delta':
      case 'model.delta':
        setOperationPhase('generating');
        break;
      case 'operation.completed':
      case 'operation.failed':
      case 'operation.aborted':
        setOperationPhase('preparing');
        break;
      default:
        break;
    }

    const binding = operationBindingsRef.current.get(event.operationId);
    if (!binding) {
      const buffered = pendingCopilotEventsRef.current.get(event.operationId) ?? [];
      pendingCopilotEventsRef.current.set(event.operationId, [...buffered, event]);
      return;
    }

    const accumulator = getOrCreateAccumulator(event.operationId, binding.messageId, binding.sessionKey);

    switch (event.type) {
      case 'model.thinking_delta':
        accumulator.pushThinkingChunk(event.text);
        break;

      case 'model.delta':
        if (event.channel === 'chat') {
          accumulator.pushChunk(event.text);
        } else if (event.channel === 'draft') {
          // Draft deltas → editor store for streaming preview.
          // Track the operationId so the preview overlay can abort it.
          const es = useEditorStore.getState();
          if (!es.activeDraftOperationId) {
            es.setActiveDraftOperationId(event.operationId);
          }
          // Throttle via RAF to prevent "Maximum update depth exceeded"
          // when deltas arrive faster than React can render.
          scheduleDraftFlush(event.text);
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

      case 'operation.completed': {
        // Flush any pending draft buffer so the editor gets the final text.
        if (draftBufferRef.current) {
          if (draftRafRef.current !== null) {
            cancelAnimationFrame(draftRafRef.current);
            draftRafRef.current = null;
          }
          flushDraftBuffer();
        }

        // For draft-mode operations (rewrite/expand/compress/continue-writing)
        // show a short status label instead of the full generated text.
        // Even if the recipe fell back to chat mode (e.g. missing selection),
        // we still replace the content with the label — the text is already
        // in the editor preview, duplicating it in chat is confusing.
        const draftLabel = DRAFT_INTENT_LABELS[binding.intent ?? ''];
        if (draftLabel) {
          // Replace any streamed chat content with the status label
          useChatStore.getState().updateMessageInSession(
            binding.sessionKey,
            binding.messageId,
            (msg) => {
              msg.content = draftLabel;
              delete msg.streamBuffer;
            },
          );
        } else {
          // Non-draft operations: inject label only if message is empty
          const completedMsg = useChatStore.getState().sessions[binding.sessionKey]
            ?.messages.find((m) => m.id === binding.messageId);
          const hasContent = Boolean(
            completedMsg && ((completedMsg.streamBuffer ?? completedMsg.content).trim().length > 0),
          );
          if (!hasContent) {
            const label = (event as { resultSummary?: string }).resultSummary
              ?? '✓ 操作已完成';
            accumulator.pushChunk(label);
          }
        }
        finalizeOperation(event.operationId);
        break;
      }

      case 'operation.failed':
        // If a draft operation was active, show the error in the preview
        // overlay instead of only in chat.
        if (useEditorStore.getState().activeDraftOperationId === event.operationId) {
          window.dispatchEvent(new CustomEvent('ai:draftError', {
            detail: { message: event.message },
          }));
        } else {
          accumulator.pushChunk(`\n\n**Error:** ${event.message}`);
        }
        useEditorStore.getState().clearDraftStreamText();
        finalizeOperation(event.operationId);
        break;

      case 'operation.aborted':
        useEditorStore.getState().clearDraftStreamText();
        finalizeOperation(event.operationId);
        break;

      case 'operation.clarification_required':
        finalizeOperation(event.operationId, false);
        void syncPendingClarification(binding.sessionKey);
        break;

      case 'patch.deferred':
        // Two-stage confirmation: store patch on the assistant message
        useChatStore.getState().updateMessageInSession(
          binding.sessionKey,
          binding.messageId,
          (msg) => {
            const patches = msg.pendingEditorPatches ?? [];
            patches.push({
              id: crypto.randomUUID(),
              patch: event.patch as unknown as Record<string, unknown>,
              summary: event.summary ?? '',
              applied: false,
            });
            msg.pendingEditorPatches = patches;
          },
        );
        break;

      default:
        break;
    }
  }, [finalizeOperation, getOrCreateAccumulator, syncPendingClarification, scheduleDraftFlush, flushDraftBuffer]);

  const flushPendingCopilotEvents = useCallback((operationId: string) => {
    const pending = pendingCopilotEventsRef.current.get(operationId) ?? [];
    pendingCopilotEventsRef.current.delete(operationId);
    for (const event of pending) {
      handleCopilotEvent(event);
    }
  }, [handleCopilotEvent]);

  const registerOperationBinding = useCallback((operationId: string, messageId: string, targetSessionKey: string, intent?: string) => {
    operationBindingsRef.current.set(operationId, { messageId, sessionKey: targetSessionKey, ...(intent !== undefined && { intent }) });
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
      if (draftRafRef.current !== null) {
        cancelAnimationFrame(draftRafRef.current);
        draftRafRef.current = null;
      }
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
        attachments: collectAttachments(),
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
        const reasoning = useChatStore.getState().chatReasoningEnabled || undefined;
        const envelope = buildChatCopilotEnvelope(sessionKey, text, chatContext, { reasoning });
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

  /** 以明确 intent 发送（写作快捷操作） */
  const handleIntentSend = useCallback(
    async (text: string, intent: import('../../../../copilot-runtime/types').CopilotIntent) => {
      if (sendingRef.current) return;
      sendingRef.current = true;

      // For editor mutations, immediately show the preview overlay in
      // "waiting" state (empty streaming text + blinking cursor) so the
      // user gets instant feedback before the first LLM delta arrives.
      const EDITOR_MUTATION_INTENTS = new Set([
        'rewrite-selection', 'expand-selection', 'compress-selection', 'continue-writing',
      ]);
      if (EDITOR_MUTATION_INTENTS.has(intent)) {
        useEditorStore.getState().appendDraftStreamText('');
      }

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        status: 'sending',
        attachments: collectAttachments(),
      };

      useChatStore.getState().ensureSession(sessionKey);
      useChatStore.getState().addMessage(userMessage);
      persistMessage({ ...userMessage, status: 'completed' }, sessionKey);

      const chatContext = {
        ...buildChatContext(),
        conversationKey: sessionKey,
      };

      try {
        const reasoning = useChatStore.getState().chatReasoningEnabled || undefined;
        const envelope = buildChatCopilotEnvelope(sessionKey, text, chatContext, { intent, reasoning });
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
        registerOperationBinding(envelope.operation.id, assistantMessage.id, sessionKey, intent);

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

  // 监听 FloatingToolbar 的 AI intent 事件
  useEffect(() => {
    const handler = (e: Event) => {
      const intent = (e as CustomEvent<{ intent: import('../../../../copilot-runtime/types').CopilotIntent }>).detail?.intent;
      if (intent) {
        const label: Record<string, string> = {
          'rewrite-selection': '改写选区',
          'expand-selection': '扩展选区',
          'compress-selection': '压缩选区',
          'continue-writing': '续写',
        };
        void handleIntentSend(label[intent] ?? intent, intent);
      }
    };
    window.addEventListener('ai:writingIntent', handler);
    return () => window.removeEventListener('ai:writingIntent', handler);
  }, [handleIntentSend]);

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

  const handleApplyPatch = useCallback((messageId: string, patchId: string) => {
    const session = useChatStore.getState().sessions[sessionKey];
    const message = session?.messages.find((m) => m.id === messageId);
    const pendingPatch = message?.pendingEditorPatches?.find((p) => p.id === patchId);
    if (!pendingPatch || pendingPatch.applied) return;

    // Dispatch the patch to the editor via the standard event mechanism
    window.dispatchEvent(new CustomEvent('ai:applyEditorPatch', {
      detail: { command: 'apply-editor-patch', patch: pendingPatch.patch },
    }));

    // Mark as applied
    useChatStore.getState().updateMessageInSession(sessionKey, messageId, (msg) => {
      const target = msg.pendingEditorPatches?.find((p) => p.id === patchId);
      if (target) target.applied = true;
    });
  }, [sessionKey]);

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
            onApplyPatch={handleApplyPatch}
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
      <div ref={inputFrameRef} className="chat-dock-input-overlay" style={{ position: 'absolute', left: 16, right: 16, bottom: 18, zIndex: 3, pointerEvents: 'none' }}>
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
            onIntentSend={handleIntentSend}
            onAbort={handleAbort}
            streaming={chatStreaming}
            statusText={chatStreaming ? derivedStatusText : undefined}
            statusMode={derivedStatusMode}
          />
        </div>
      </div>
    </div>
  );
});
