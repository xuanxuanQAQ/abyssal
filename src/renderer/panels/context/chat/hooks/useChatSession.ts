/**
 * useChatSession — 统一会话管理（单一连续对话）
 *
 * 核心设计变更：一个 workspace 维护一个连续对话。
 * 切换上下文面板（论文→图谱→概念）不会切割对话历史，
 * 只是系统提示词中注入的上下文随焦点自动变化。
 *
 * 数据流规则：
 * - 写入路径：Zustand 同步写入 + IPC 异步落库（并行）
 * - 读取路径：热缓存优先 → TanStack Query 从数据库加载
 */

import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useChatStore } from '../../../../core/store/useChatStore';
import { getAPI } from '../../../../core/ipc/bridge';
import type { ChatMessage, ChatMessageRecord } from '../../../../../shared-types/models';

/** Fixed session key — all messages belong to one continuous conversation */
const SESSION_KEY = 'workspace';

/**
 * ChatMessageRecord → ChatMessage 转换
 */
function recordToMessage(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    timestamp: record.timestamp,
    status: 'completed',
    toolCalls: record.toolCalls ? JSON.parse(record.toolCalls) : undefined,
    citations: record.citations ? JSON.parse(record.citations) : undefined,
  };
}

/**
 * ChatMessage → ChatMessageRecord 转换（用于持久化）
 */
export function messageToRecord(
  msg: ChatMessage,
  contextKey: string
): ChatMessageRecord {
  const record: ChatMessageRecord = {
    id: msg.id,
    contextSourceKey: contextKey,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  if (msg.toolCalls) record.toolCalls = JSON.stringify(msg.toolCalls);
  if (msg.citations) record.citations = JSON.stringify(msg.citations);
  return record;
}

/**
 * 持久化消息到 SQLite（异步，不阻塞 UI）
 */
export function persistMessage(msg: ChatMessage, contextKey: string): void {
  const record = messageToRecord(msg, contextKey);
  getAPI().db.chat.saveMessage(record).catch((err: unknown) => {
    console.error('[ChatSession] Failed to persist message:', err);
    toast.error('消息保存失败，聊天记录可能丢失', { id: 'chat-persist-error', duration: 3000 });
  });
}

export function useChatSession() {
  const queryClient = useQueryClient();

  const {
    sessions,
    ensureSession,
    loadSessionMessages,
    setActiveSessionKey,
  } = useChatStore();

  // 从数据库加载历史（当热缓存未命中时）
  const { data: dbHistory } = useQuery({
    queryKey: ['chat', 'history', SESSION_KEY],
    queryFn: async () => {
      const records = await getAPI().db.chat.getHistory(SESSION_KEY, { limit: 50 });
      return records.map(recordToMessage);
    },
    staleTime: Infinity,
    gcTime: 300_000,
    enabled: !sessions[SESSION_KEY],
  });

  // 初始化统一会话 + 从 DB 填充热缓存
  useEffect(() => {
    ensureSession(SESSION_KEY);
    setActiveSessionKey(SESSION_KEY);

    if (dbHistory && dbHistory.length > 0) {
      const cached = useChatStore.getState().sessions[SESSION_KEY];
      if (cached && cached.messages.length === 0) {
        loadSessionMessages(SESSION_KEY, dbHistory, dbHistory.length < 50);
      }
    }
  }, [ensureSession, setActiveSessionKey, loadSessionMessages, dbHistory]);

  /** 清除对话（UI + 数据库 + 后端内存） */
  const clearCurrentSession = useCallback(() => {
    useChatStore.getState().clearSession(SESSION_KEY);
    getAPI().db.chat.deleteSession(SESSION_KEY).catch((err: unknown) => {
      console.error('[ChatSession] Failed to delete session:', err);
    });
    queryClient.removeQueries({ queryKey: ['chat', 'history', SESSION_KEY] });
  }, [queryClient]);

  /** 加载更早的历史消息 */
  const loadMoreHistory = useCallback(async () => {
    const session = useChatStore.getState().sessions[SESSION_KEY];
    if (!session || session.fullyLoaded) return;

    const oldestMsg = session.messages[0];
    const beforeTimestamp = oldestMsg?.timestamp ?? Date.now();

    try {
      const records = await getAPI().db.chat.getHistory(SESSION_KEY, {
        limit: 50,
        beforeTimestamp,
      });
      const olderMessages = records.map(recordToMessage);
      const isFullyLoaded = olderMessages.length < 50;

      const currentSession = useChatStore.getState().sessions[SESSION_KEY];
      const existingMessages = currentSession?.messages ?? [];

      useChatStore.getState().loadSessionMessages(
        SESSION_KEY,
        [...olderMessages, ...existingMessages],
        isFullyLoaded,
      );
    } catch (err) {
      console.error('[ChatSession] Failed to load more history:', err);
    }
  }, []);

  const currentSession = sessions[SESSION_KEY];

  return {
    /** Fixed session key for store/persistence operations */
    sessionKey: SESSION_KEY,
    messages: currentSession?.messages ?? [],
    fullyLoaded: currentSession?.fullyLoaded ?? false,
    clearCurrentSession,
    loadMoreHistory,
  };
}
