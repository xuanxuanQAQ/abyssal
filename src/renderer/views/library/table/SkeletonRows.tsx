/**
 * SkeletonRows — 加载态骨架屏行（§15.2）
 */

import React from 'react';

export function SkeletonRows() {
  return (
    <div style={{ flex: 1, padding: '8px 0' }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            height: 40,
            alignItems: 'center',
            padding: '0 8px',
            gap: 8,
          }}
        >
          {/* select */}
          <div style={{ width: 36 }}>
            <div style={skeletonBlock(16, 16)} />
          </div>
          {/* relevance */}
          <div style={{ width: 40 }}>
            <div style={skeletonBlock(14, 14)} />
          </div>
          {/* title */}
          <div style={{ flex: 1 }}>
            <div style={skeletonBlock(undefined, 12, `${60 + Math.random() * 30}%`)} />
          </div>
          {/* authors */}
          <div style={{ width: 160 }}>
            <div style={skeletonBlock(undefined, 12, '70%')} />
          </div>
          {/* year */}
          <div style={{ width: 60, textAlign: 'center' }}>
            <div style={skeletonBlock(40, 12)} />
          </div>
          {/* type */}
          <div style={{ width: 80 }}>
            <div style={skeletonBlock(40, 16)} />
          </div>
          {/* fulltext */}
          <div style={{ width: 48, textAlign: 'center' }}>
            <div style={skeletonBlock(14, 14)} />
          </div>
          {/* analysis */}
          <div style={{ width: 48, textAlign: 'center' }}>
            <div style={skeletonBlock(14, 14)} />
          </div>
          {/* note */}
          <div style={{ width: 120 }}>
            <div style={skeletonBlock(undefined, 12, '50%')} />
          </div>
          {/* date */}
          <div style={{ width: 100 }}>
            <div style={skeletonBlock(60, 12)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function skeletonBlock(
  width?: number,
  height?: number,
  widthPercent?: string
): React.CSSProperties {
  return {
    width: widthPercent ?? width,
    height: height ?? 12,
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-surface-low, #e5e7eb)',
    opacity: 0.5,
    animation: 'pulse 1.5s ease-in-out infinite',
  };
}
