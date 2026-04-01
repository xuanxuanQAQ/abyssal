/**
 * CrossfadeTransition — ContentPane 切换的交叉淡入淡出（§11）
 *
 * 统一动画规范：
 * - 退出：100ms, opacity→0 + translateY(0→-6px)
 * - 进入：200ms, ctx-enter keyframe
 * - 缓动：cubic-bezier(0.16, 1, 0.3, 1)
 *
 * 当 animationEnabled === false 时，直接硬切。
 * 过渡期间滚动位置重置到顶部。
 *
 * 优化：用 CSS transitionend/animationend 事件驱动状态机，
 * 替代 setTimeout 链，动画在 compositor 线程执行，主线程零阻塞。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLayout } from '../../../core/context/LayoutContext';

const EXIT_MS = 100;
const ENTER_MS = 200;
const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

interface CrossfadeTransitionProps {
  transitionKey: string;
  children: React.ReactNode;
}

export function CrossfadeTransition({
  transitionKey,
  children,
}: CrossfadeTransitionProps) {
  const { animationEnabled } = useLayout();
  const [displayKey, setDisplayKey] = useState(transitionKey);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingKeyRef = useRef(transitionKey);

  pendingKeyRef.current = transitionKey;

  useEffect(() => {
    if (transitionKey === displayKey) return;

    if (!animationEnabled) {
      setDisplayKey(transitionKey);
      return;
    }

    setPhase('exit');
    // 不再用 setTimeout — onTransitionEnd 驱动下一步
  }, [transitionKey, displayKey, animationEnabled]);

  // exit 动画完成 → 切换内容 + 进入动画
  const handleTransitionEnd = useCallback((e: React.TransitionEvent) => {
    // opacity 和 transform 都会触发，只处理一次
    if (phase !== 'exit' || e.propertyName !== 'opacity') return;
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setDisplayKey(pendingKeyRef.current);
    setPhase('enter');
  }, [phase]);

  // enter 动画完成 → 回到空闲
  const handleAnimationEnd = useCallback(() => {
    if (phase !== 'enter') return;
    setPhase('idle');
  }, [phase]);

  const style: React.CSSProperties =
    phase === 'exit'
      ? {
          opacity: 0,
          transform: 'translateY(-6px)',
          transition: `opacity ${EXIT_MS}ms ${EASING}, transform ${EXIT_MS}ms ${EASING}`,
        }
      : phase === 'enter'
        ? {
            opacity: 0,
            transform: 'translateY(6px)',
            animation: `ctx-enter ${ENTER_MS}ms ${EASING} forwards`,
          }
        : {};

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'hidden',
        ...style,
      }}
      onTransitionEnd={handleTransitionEnd}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
