/**
 * useChatSession — 统一会话管理（多会话）
 *
 * 每个 sessionKey 对应一条独立对话上下文。
 * 新建会话会生成新的 sessionKey，前后端都按该 key 隔离。
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

const DEFAULT_SESSION_KEY = 'workspace';

function generateSessionKey(): string {
  return `chat:${Date.now().toString(36)}:${crypto.randomUUID().slice(0, 8)}`;
}

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
    activeSessionKey,
    sessions,
    ensureSession,
    loadSessionMessages,
    setActiveSessionKey,
  } = useChatStore();

  const sessionKey = activeSessionKey || DEFAULT_SESSION_KEY;

  // 从数据库加载历史（当热缓存未命中时）
  const { data: dbHistory } = useQuery({
    queryKey: ['chat', 'history', sessionKey],
    queryFn: async () => {
      const records = await getAPI().db.chat.getHistory(sessionKey, { limit: 50 });
      return records.map(recordToMessage);
    },
    staleTime: 30_000,
    gcTime: 300_000,
    enabled: !sessions[sessionKey],
  });

  // 初始化会话 + 从 DB 填充热缓存
  useEffect(() => {
    const key = activeSessionKey || DEFAULT_SESSION_KEY;
    ensureSession(key);
    if (!activeSessionKey) {
      setActiveSessionKey(key);
    }

    if (dbHistory && dbHistory.length > 0) {
      const cached = useChatStore.getState().sessions[key];
      if (cached && cached.messages.length === 0) {
        loadSessionMessages(key, dbHistory, dbHistory.length < 50);
      }
    }
  }, [activeSessionKey, ensureSession, setActiveSessionKey, loadSessionMessages, dbHistory]);

  const createNewSession = useCallback(() => {
    const newKey = generateSessionKey();
    useChatStore.getState().ensureSession(newKey);
    useChatStore.getState().setActiveSessionKey(newKey);
  }, []);

  const switchSession = useCallback((key: string) => {
    useChatStore.getState().ensureSession(key);
    useChatStore.getState().setActiveSessionKey(key);
  }, []);

  /** 清除对话（UI + 数据库 + 后端内存） */
  const clearCurrentSession = useCallback(() => {
    useChatStore.getState().clearSession(sessionKey);
    getAPI().db.chat.deleteSession(sessionKey).catch((err: unknown) => {
      console.error('[ChatSession] Failed to delete session:', err);
    });
    queryClient.removeQueries({ queryKey: ['chat', 'history', sessionKey] });
  }, [queryClient, sessionKey]);

  /** 加载更早的历史消息 */
  const loadMoreHistory = useCallback(async () => {
    const session = useChatStore.getState().sessions[sessionKey];
    if (!session || session.fullyLoaded) return;

    const oldestMsg = session.messages[0];
    const beforeTimestamp = oldestMsg?.timestamp ?? Date.now();

    try {
      const records = await getAPI().db.chat.getHistory(sessionKey, {
        limit: 50,
        beforeTimestamp,
      });
      const olderMessages = records.map(recordToMessage);
      const isFullyLoaded = olderMessages.length < 50;

      const currentSession = useChatStore.getState().sessions[sessionKey];
      const existingMessages = currentSession?.messages ?? [];

      useChatStore.getState().loadSessionMessages(
        sessionKey,
        [...olderMessages, ...existingMessages],
        isFullyLoaded,
      );
    } catch (err) {
      console.error('[ChatSession] Failed to load more history:', err);
    }
  }, [sessionKey]);

  const currentSession = sessions[sessionKey];

  return {
    sessionKey,
    messages: currentSession?.messages ?? [],
    fullyLoaded: currentSession?.fullyLoaded ?? false,
    createNewSession,
    switchSession,
    clearCurrentSession,
    loadMoreHistory,
  };
}
