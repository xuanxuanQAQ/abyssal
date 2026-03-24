/**
 * TitleBar — 自绘标题栏（§3）
 *
 * 44px 高度，flexbox 三段布局：
 * - 左段：ProjectSelector
 * - 中段：GlobalSearch 触发按钮
 * - 右段：WindowControls
 *
 * 拖拽区域通过 CSS -webkit-app-region 分层管理。
 * §3.2.1 双击穿透防护：所有交互元素绑定 onDoubleClick stopPropagation。
 */

import React, { useCallback } from 'react';
import { Search } from 'lucide-react';
import { ProjectSelector } from './ProjectSelector';
import { WindowControls } from './WindowControls';
import { useAppStore } from '../../core/store';
import { getAPI } from '../../core/ipc/bridge';

export function TitleBar() {
  const openGlobalSearch = useAppStore((s) => s.openGlobalSearch);

  // §3.2 双击 TitleBar 拖拽区域 → 最大化/还原
  const handleDoubleClick = useCallback(() => {
    getAPI().app.window.toggleMaximize();
  }, []);

  return (
    <div
      className="titlebar app-shell__titlebar"
      style={{
        height: 'var(--titlebar-height)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        backgroundColor: 'var(--bg-surface-lowest)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* 左段：ProjectSelector */}
      <div style={{ flex: '0 0 auto', paddingLeft: 4 }}>
        <ProjectSelector />
      </div>

      {/* 中段：GlobalSearch 触发区 */}
      <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center' }}>
        <button
          className="titlebar__interactive"
          onClick={openGlobalSearch}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            width: 'clamp(280px, 30vw, 400px)',
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-hover)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          <Search size={14} />
          <span>搜索… Ctrl+K</span>
        </button>
      </div>

      {/* 右段：WindowControls */}
      <div style={{ flex: '0 0 auto' }}>
        <WindowControls />
      </div>
    </div>
  );
}
