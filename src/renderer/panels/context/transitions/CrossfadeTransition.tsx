/**
 * CrossfadeTransition — ContentPane 切换的交叉淡入淡出（§11）
 *
 * 统一动画规范：
 * - 退出：var(--duration-fast) 100ms, opacity→0 + translateY(0→-6px)
 * - 进入：var(--duration-normal) 200ms, ctx-enter keyframe
 * - 缓动：var(--easing-default)
 *
 * 当 animationEnabled === false 时，直接硬切。
 * 过渡期间滚动位置重置到顶部。
 */

import React, { useState, useEffect, useRef } from 'react';
import { useLayout } from '../../../core/context/LayoutContext';

// 与 CSS 变量保持一致（JS 中无法直接读取，镜像定义）
const EXIT_MS = 100;  // --duration-fast
const ENTER_MS = 200; // --duration-normal

interface CrossfadeTransitionProps {
  /** 变化时触发过渡的标识 key */
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

  useEffect(() => {
    if (transitionKey === displayKey) return;

    if (!animationEnabled) {
      setDisplayKey(transitionKey);
      return;
    }

    // 开始退出动画
    setPhase('exit');

    const exitTimer = setTimeout(() => {
      setDisplayKey(transitionKey);
      setPhase('enter');

      // 重置滚动位置
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
      }

      const enterTimer = setTimeout(() => {
        setPhase('idle');
      }, ENTER_MS);

      return () => clearTimeout(enterTimer);
    }, EXIT_MS);

    return () => clearTimeout(exitTimer);
  }, [transitionKey, displayKey, animationEnabled]);

  const style: React.CSSProperties =
    phase === 'exit'
      ? {
          opacity: 0,
          transform: 'translateY(-6px)',
          transition: `opacity ${EXIT_MS}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${EXIT_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        }
      : phase === 'enter'
        ? {
            opacity: 0,
            transform: 'translateY(6px)',
            animation: `ctx-enter ${ENTER_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
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
    >
      {children}
    </div>
  );
}
