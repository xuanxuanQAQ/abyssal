/**
 * useAutoScroll — 自动滚动策略（§6.4）
 *
 * 状态模型：
 * - isUserScrolledUp: 用户是否主动向上滚动了
 * - unreadCount: 用户滚动到上方后，底部新产生的消息数量
 *
 * 判定逻辑：
 * - scrollTop + clientHeight >= scrollHeight - 40px → 在底部
 * - 用户主动向上滚动使得距底部 > 40px → isUserScrolledUp = true
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const BOTTOM_THRESHOLD = 40;

interface AutoScrollState {
  isUserScrolledUp: boolean;
  unreadCount: number;
}

export function useAutoScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  messageCount: number,
  isStreaming: boolean
) {
  const [state, setState] = useState<AutoScrollState>({
    isUserScrolledUp: false,
    unreadCount: 0,
  });
  const prevCountRef = useRef(messageCount);
  const rafRef = useRef<number | null>(null);
  const userScrollingRef = useRef(false);

  const isAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD;
  }, [containerRef]);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
      setState({ isUserScrolledUp: false, unreadCount: 0 });
    },
    [containerRef]
  );

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    if (isAtBottom()) {
      setState({ isUserScrolledUp: false, unreadCount: 0 });
    } else {
      setState((prev) => ({
        ...prev,
        isUserScrolledUp: true,
      }));
    }
  }, [isAtBottom]);

  // 新消息到达时的自动滚动
  useEffect(() => {
    if (messageCount > prevCountRef.current) {
      const newMessages = messageCount - prevCountRef.current;
      if (state.isUserScrolledUp) {
        setState((prev) => ({
          ...prev,
          unreadCount: prev.unreadCount + newMessages,
        }));
      } else {
        scrollToBottom();
      }
    } else if (messageCount < prevCountRef.current) {
      // Session reset (message count decreased) — clear scroll state
      userScrollingRef.current = false;
      setState({ isUserScrolledUp: false, unreadCount: 0 });
    }
    prevCountRef.current = messageCount;
  }, [messageCount, state.isUserScrolledUp, scrollToBottom]);

  // wheel 事件检测用户滚动意图（在 scroll 位置改变之前触发，可靠中断 RAF）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!isStreaming) return;
      // 向上滚动：立即标记用户主动滚动，中断 RAF
      if (e.deltaY < 0) {
        userScrollingRef.current = true;
        setState((prev) => ({ ...prev, isUserScrolledUp: true }));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isStreaming, containerRef]);

  // 流式输出期间 RAF 自动滚动
  useEffect(() => {
    if (!isStreaming || state.isUserScrolledUp) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      userScrollingRef.current = false;
      return;
    }

    const tick = () => {
      // wheel 事件已触发，停止强制滚动
      if (userScrollingRef.current) {
        rafRef.current = null;
        return;
      }
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isStreaming, state.isUserScrolledUp, containerRef]);

  return {
    isUserScrolledUp: state.isUserScrolledUp,
    unreadCount: state.unreadCount,
    handleScroll,
    scrollToBottom,
  };
}
