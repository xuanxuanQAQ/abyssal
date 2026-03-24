/**
 * MatrixViewport — 【Δ-1】Scroll container with spacer div and Canvas management.
 *
 * - overflow: auto, will-change: scroll-position
 * - Contains spacer div (totalWidth × totalHeight, 【Δ-5】capped with console.warn if > 30000px)
 * - Passive scroll event listener, calls onScroll
 * - Canvas is positioned sticky inside
 */

import React, { useRef, useEffect, useCallback, type ReactNode } from 'react';

const MAX_DIMENSION = 30_000;

interface MatrixViewportProps {
  totalWidth: number;
  totalHeight: number;
  onScroll: (scrollLeft: number, scrollTop: number) => void;
  children: ReactNode;
}

export function MatrixViewport({
  totalWidth,
  totalHeight,
  onScroll,
  children,
}: MatrixViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  // 【Δ-5】Cap dimensions with console.warn
  const clampedWidth = totalWidth;
  const clampedHeight = totalHeight;

  if (totalWidth > MAX_DIMENSION) {
    console.warn(
      `[MatrixViewport] totalWidth (${totalWidth}px) exceeds ${MAX_DIMENSION}px cap.`,
    );
  }
  if (totalHeight > MAX_DIMENSION) {
    console.warn(
      `[MatrixViewport] totalHeight (${totalHeight}px) exceeds ${MAX_DIMENSION}px cap.`,
    );
  }

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    onScrollRef.current(el.scrollLeft, el.scrollTop);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div
      ref={containerRef}
      style={{
        overflow: 'auto',
        width: '100%',
        height: '100%',
        position: 'relative',
        willChange: 'scroll-position',
      }}
    >
      {/* Spacer div to create scrollable area */}
      <div
        style={{
          width: clampedWidth,
          height: clampedHeight,
          position: 'relative',
          pointerEvents: 'none',
        }}
      />

      {/* Sticky canvas layer — children positioned over the spacer */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          marginTop: -clampedHeight,
          pointerEvents: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
