/**
 * ChunkAccumulator — 非 React 的 chunk 累积器（§5.4）
 *
 * RAF 节流：每帧最多将 streamBuffer 同步到 useChatStore 一次。
 * isLast 时 finalize：将 streamBuffer 移动到 content，
 * 清空 streamBuffer，设置 status='completed'，触发 SQLite 持久化。
 */

import { useChatStore } from '../../../../core/store/useChatStore';
import type { ToolCallInfo } from '../../../../../shared-types/models';

export interface ChunkAccumulatorOptions {
  onFinalize?: (messageId: string, content: string, sessionKey: string) => void;
}

export class ChunkAccumulator {
  private rafId: number | null = null;
  private dirty = false;
  private messageId: string | null = null;
  private sessionKey: string | null = null;
  private options: ChunkAccumulatorOptions;

  constructor(options: ChunkAccumulatorOptions = {}) {
    this.options = options;
  }

  /**
   * 绑定到某条 assistant 消息
   */
  bind(messageId: string, sessionKey: string): void {
    this.messageId = messageId;
    this.sessionKey = sessionKey;
  }

  /**
   * 接收文本 chunk
   */
  pushChunk(chunk: string): void {
    if (!this.sessionKey) return;
    useChatStore.getState().appendToStreamBufferInSession(this.sessionKey, chunk);
    this.dirty = true;
    this.scheduleFlush();
  }

  /**
   * 接收 tool call 更新
   */
  pushToolCall(toolCall: ToolCallInfo): void {
    if (!this.messageId || !this.sessionKey) return;
    useChatStore.getState().updateMessageInSession(this.sessionKey, this.messageId, (msg) => {
      if (!msg.toolCalls) msg.toolCalls = [];
      const existing = msg.toolCalls.find((tc) => tc.name === toolCall.name);
      if (existing) {
        existing.status = toolCall.status;
        if (toolCall.output !== undefined) existing.output = toolCall.output;
        if (toolCall.duration !== undefined) existing.duration = toolCall.duration;
      } else {
        msg.toolCalls.push(toolCall);
      }
    });
  }

  /**
   * 流式结束——finalize
   */
  finalize(): void {
    this.cancelFlush();

    const store = useChatStore.getState();
    if (!this.sessionKey) {
      store.setChatStreaming(false);
      this.messageId = null;
      return;
    }

    // 将 streamBuffer 内容移到 content
    store.flushStreamBufferInSession(this.sessionKey);

    if (this.messageId) {
      store.updateMessageInSession(this.sessionKey, this.messageId, (msg) => {
        msg.content = msg.streamBuffer ?? msg.content;
        delete msg.streamBuffer;
        msg.status = 'completed';
      });

      // 获取最终内容用于持久化
      const session = useChatStore.getState().sessions[this.sessionKey];
      const finalMsg = session?.messages.find((m) => m.id === this.messageId);
      if (finalMsg) {
        this.options.onFinalize?.(this.messageId, finalMsg.content, this.sessionKey);
      }
    }

    store.setChatStreaming(false);
    this.messageId = null;
    this.sessionKey = null;
  }

  /**
   * 错误终止
   */
  abort(): void {
    this.cancelFlush();
    if (this.messageId && this.sessionKey) {
      useChatStore.getState().updateMessageInSession(this.sessionKey, this.messageId, (msg) => {
        msg.status = 'error';
        delete msg.streamBuffer;
      });
    }
    useChatStore.getState().setChatStreaming(false);
    this.messageId = null;
    this.sessionKey = null;
  }

  private scheduleFlush(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.dirty) {
        this.dirty = false;
        if (this.sessionKey) {
          useChatStore.getState().flushStreamBufferInSession(this.sessionKey);
        }
      }
    });
  }

  private cancelFlush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.cancelFlush();
    this.messageId = null;
    this.sessionKey = null;
  }
}
