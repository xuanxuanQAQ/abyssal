/**
 * useChatStore — 聊天 UI 独立 Store（§5.1.3 分层会话架构）
 *
 * 热缓存层：最多保留当前 + 最近 3 个活跃会话的消息数据（共 4 个）。
 * LRU 淘汰只移除内存引用，不删除 SQLite 记录。
 *
 * 流式响应期间高频追加消息，
 * 且聊天状态可独立于主视图生命周期存在。
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, ChatSessionCache } from '../../../shared-types/models';

const MAX_CACHED_SESSIONS = 4;

/** ChatDock 三种形态（§1.2） */
export type ChatDockMode = 'collapsed' | 'expanded' | 'fullscreen';

interface ChatState {
  /** 当前活跃会话的 contextSourceKey */
  activeSessionKey: string;
  /** 热缓存中的会话数据（最多 4 个） */
  sessions: Record<string, ChatSessionCache>;
  /** 输入框草稿文本 */
  chatInputDraft: string;
  /** 是否正在接收流式响应 */
  chatStreaming: boolean;
  /** ChatDock 形态 */
  chatDockMode: ChatDockMode;

  // ── Actions ──
  setActiveSessionKey: (key: string) => void;
  setChatInputDraft: (draft: string) => void;
  setChatStreaming: (streaming: boolean) => void;
  setChatDockMode: (mode: ChatDockMode) => void;

  /** 确保会话存在于热缓存中（不存在则创建空会话） */
  ensureSession: (key: string) => void;
  /** 用从数据库加载的消息填充热缓存 */
  loadSessionMessages: (key: string, messages: ChatMessage[], fullyLoaded: boolean) => void;
  /** 向前加载更早的历史消息 */
  prependMessages: (key: string, messages: ChatMessage[]) => void;
  /** 添加消息到当前会话 */
  addMessage: (message: ChatMessage) => void;
  /** 更新指定消息（用于流式完成、状态变更） */
  updateMessage: (messageId: string, updater: (msg: ChatMessage) => void) => void;
  /** 追加文本到最后一条 assistant 消息的 streamBuffer */
  appendToStreamBuffer: (chunk: string) => void;
  /** 将 streamBuffer 刷新到 content（RAF 节流后调用） */
  flushStreamBuffer: () => void;
  /** 清除指定会话的消息 */
  clearSession: (key: string) => void;
  /** 完全重置聊天状态（项目切换时使用） */
  clearChatHistory: () => void;
}

/** 确保 state.sessions[key] 存在，不存在时创建空会话（含 LRU 淘汰） */
function ensureSessionInState(state: ChatState, key: string): void {
  if (state.sessions[key]) {
    state.sessions[key]!.lastActiveAt = Date.now();
    return;
  }
  const keys = Object.keys(state.sessions);
  if (keys.length >= MAX_CACHED_SESSIONS) {
    let oldestKey = keys[0]!;
    let oldestTime = state.sessions[oldestKey]!.lastActiveAt;
    for (const k of keys) {
      if (k === state.activeSessionKey) continue;
      const session = state.sessions[k];
      if (session && session.lastActiveAt < oldestTime) {
        oldestKey = k;
        oldestTime = session.lastActiveAt;
      }
    }
    if (oldestKey !== state.activeSessionKey) {
      delete state.sessions[oldestKey];
    }
  }
  state.sessions[key] = {
    contextSourceKey: key,
    messages: [],
    lastActiveAt: Date.now(),
    fullyLoaded: true, // default true; loadSessionMessages sets to false when DB has more pages
  };
}

export const useChatStore = create<ChatState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        activeSessionKey: 'workspace',
        sessions: {},
        chatInputDraft: '',
        chatStreaming: false,
        chatDockMode: 'collapsed' as ChatDockMode,

        setActiveSessionKey: (key) =>
          set((state) => {
            state.activeSessionKey = key;
          }),

        setChatInputDraft: (draft) =>
          set((state) => {
            state.chatInputDraft = draft;
          }),

        setChatStreaming: (streaming) =>
          set((state) => {
            state.chatStreaming = streaming;
          }),

        setChatDockMode: (mode) =>
          set((state) => {
            state.chatDockMode = mode;
          }),

        ensureSession: (key) =>
          set((state) => {
            ensureSessionInState(state, key);
          }),

        loadSessionMessages: (key, messages, fullyLoaded) =>
          set((state) => {
            const session = state.sessions[key];
            if (session) {
              session.messages = messages;
              session.fullyLoaded = fullyLoaded;
              session.lastActiveAt = Date.now();
            }
          }),

        prependMessages: (key, messages) =>
          set((state) => {
            const session = state.sessions[key];
            if (session) {
              session.messages = [...messages, ...session.messages];
            }
          }),

        addMessage: (message) =>
          set((state) => {
            ensureSessionInState(state, state.activeSessionKey);
            const session = state.sessions[state.activeSessionKey]!;
            session.messages.push(message);
            session.lastActiveAt = Date.now();
          }),

        updateMessage: (messageId, updater) =>
          set((state) => {
            const session = state.sessions[state.activeSessionKey];
            if (session) {
              const msg = session.messages.find((m) => m.id === messageId);
              if (msg) updater(msg);
            }
          }),

        appendToStreamBuffer: (chunk) =>
          set((state) => {
            const session = state.sessions[state.activeSessionKey];
            if (!session) return;
            const last = session.messages[session.messages.length - 1];
            if (last && last.role === 'assistant') {
              last.streamBuffer = (last.streamBuffer ?? '') + chunk;
            }
          }),

        flushStreamBuffer: () =>
          set((state) => {
            const session = state.sessions[state.activeSessionKey];
            if (!session) return;
            const last = session.messages[session.messages.length - 1];
            if (last && last.role === 'assistant' && last.streamBuffer !== undefined) {
              last.content = last.streamBuffer;
            }
          }),

        clearSession: (key) =>
          set((state) => {
            const session = state.sessions[key];
            if (session) {
              session.messages = [];
              session.fullyLoaded = true;
            }
          }),

        clearChatHistory: () =>
          set((state) => {
            state.sessions = {};
            state.activeSessionKey = 'workspace';
            state.chatInputDraft = '';
            state.chatStreaming = false;
            state.chatDockMode = 'collapsed';
          }),
      }))
    ),
    { name: 'ChatStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
