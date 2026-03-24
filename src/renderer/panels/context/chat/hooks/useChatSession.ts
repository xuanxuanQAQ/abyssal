/**
 * useChatSession — 会话管理（§5.1 热缓存 + SQLite 分层读写）
 *
 * 数据流规则：
 * - 写入路径：Zustand 同步写入 + IPC 异步落库（并行）
 * - 读取路径：热缓存优先 → TanStack Query 从数据库加载
 * - 热缓存淘汰：LRU 4 会话，淘汰只移除内存引用
 */

import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChatStore } from '../../../../core/store/useChatStore';
import { getAPI } from '../../../../core/ipc/bridge';
import { contextSourceKey } from '../../engine/contextSourceKey';
import { useEffectiveSource } from '../../engine/useEffectiveSource';
import type { ChatMessage, ChatMessageRecord } from '../../../../../shared-types/models';

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
  });
}

export function useChatSession() {
  const source = useEffectiveSource();
  const key = contextSourceKey(source);
  const queryClient = useQueryClient();

  const {
    activeSessionKey,
    sessions,
    setActiveSessionKey,
    ensureSession,
    loadSessionMessages,
  } = useChatStore();

  // 从数据库加载历史（当热缓存未命中时）
  const { data: dbHistory } = useQuery({
    queryKey: ['chat', 'history', key],
    queryFn: async () => {
      const records = await getAPI().db.chat.getHistory(key, { limit: 50 });
      return records.map(recordToMessage);
    },
    staleTime: Infinity,
    gcTime: 300_000,
    // 仅当热缓存中没有该会话时才启用
    enabled: !sessions[key],
  });

  // ContextSource 变化时切换会话
  useEffect(() => {
    if (key === activeSessionKey) return;

    setActiveSessionKey(key);
    ensureSession(key);

    // 如果热缓存中没有消息且数据库有数据，加载到热缓存
    const cached = useChatStore.getState().sessions[key];
    if (cached && cached.messages.length === 0 && dbHistory && dbHistory.length > 0) {
      loadSessionMessages(key, dbHistory, dbHistory.length < 50);
    }
  }, [key, activeSessionKey, setActiveSessionKey, ensureSession, loadSessionMessages, dbHistory]);

  // 当 dbHistory 加载完成且热缓存为空时，填充热缓存
  useEffect(() => {
    if (!dbHistory || dbHistory.length === 0) return;
    const cached = useChatStore.getState().sessions[key];
    if (cached && cached.messages.length === 0) {
      loadSessionMessages(key, dbHistory, dbHistory.length < 50);
    }
  }, [dbHistory, key, loadSessionMessages]);

  /** 清除当前会话（UI + 数据库） */
  const clearCurrentSession = useCallback(() => {
    useChatStore.getState().clearSession(key);
    getAPI().db.chat.deleteSession(key).catch((err: unknown) => {
      console.error('[ChatSession] Failed to delete session:', err);
    });
    queryClient.removeQueries({ queryKey: ['chat', 'history', key] });
  }, [key, queryClient]);

  /** 加载更早的历史消息 */
  const loadMoreHistory = useCallback(async () => {
    const session = useChatStore.getState().sessions[key];
    if (!session || session.fullyLoaded) return;

    const oldestMsg = session.messages[0];
    const beforeTimestamp = oldestMsg?.timestamp ?? Date.now();

    try {
      const records = await getAPI().db.chat.getHistory(key, {
        limit: 50,
        beforeTimestamp,
      });
      const messages = records.map(recordToMessage);
      useChatStore.getState().prependMessages(key, messages);
      if (messages.length < 50) {
        // 已加载全部历史
        useChatStore.getState().loadSessionMessages(
          key,
          [...messages, ...session.messages],
          true
        );
      }
    } catch (err) {
      console.error('[ChatSession] Failed to load more history:', err);
    }
  }, [key]);

  const currentSession = sessions[activeSessionKey];

  return {
    contextKey: key,
    messages: currentSession?.messages ?? [],
    fullyLoaded: currentSession?.fullyLoaded ?? false,
    clearCurrentSession,
    loadMoreHistory,
    source,
  };
}
