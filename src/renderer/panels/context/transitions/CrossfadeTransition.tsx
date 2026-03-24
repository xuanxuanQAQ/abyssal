/**
 * CrossfadeTransition — ContentPane 切换的交叉淡入淡出（§11）
 *
 * 旧内容退出：150ms opacity 1→0 + translateY 0→−8px
 * 新内容进入：200ms（延迟 100ms） opacity 0→1 + translateY 8px→0
 *
 * 当 animationEnabled === false 时，直接硬切。
 * 过渡期间滚动位置重置到顶部。
 */

import React, { useState, useEffect, useRef } from 'react';
import { useLayout } from '../../../core/context/LayoutContext';

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
      }, 200);

      return () => clearTimeout(enterTimer);
    }, 150);

    return () => clearTimeout(exitTimer);
  }, [transitionKey, displayKey, animationEnabled]);

  const style: React.CSSProperties =
    phase === 'exit'
      ? {
          opacity: 0,
          transform: 'translateY(-8px)',
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
        }
      : phase === 'enter'
        ? {
            opacity: 0,
            transform: 'translateY(8px)',
            animation: 'crossfade-enter 200ms ease-out forwards',
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
