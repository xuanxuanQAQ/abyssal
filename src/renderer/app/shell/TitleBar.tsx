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
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { ProjectSelector } from './ProjectSelector';
import { WindowControls } from './WindowControls';
import { useAppStore } from '../../core/store';
import { getAPI } from '../../core/ipc/bridge';

export function TitleBar() {
  const { t } = useTranslation();
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
        padding: '0 10px',
        background: 'var(--lens-surface-strong)',
        borderBottom: '1px solid var(--lens-border)',
        backdropFilter: 'blur(24px) saturate(1.08)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.08)',
        boxShadow: 'inset 0 -1px 0 var(--border-subtle)',
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
          className="titlebar__interactive shell-search-trigger"
          type="button"
          onClick={openGlobalSearch}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            width: 'clamp(300px, 32vw, 420px)',
            height: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            border: '1px solid var(--shell-search-trigger-border, var(--lens-border))',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--shell-search-trigger-bg, var(--lens-surface))',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            boxShadow: 'var(--shell-search-trigger-shadow, var(--lens-shadow-soft, var(--lens-shadow)))',
            transition: 'transform var(--duration-fast) var(--easing-default), box-shadow var(--duration-fast) var(--easing-default), background-color var(--duration-fast) var(--easing-default), border-color var(--duration-fast) var(--easing-default)',
          }}
        >
          <Search size={14} />
          <span>{t('titleBar.search')}</span>
        </button>
      </div>

      {/* 右段：WindowControls */}
      <div style={{ flex: '0 0 auto' }}>
        <WindowControls />
      </div>
    </div>
  );
}
