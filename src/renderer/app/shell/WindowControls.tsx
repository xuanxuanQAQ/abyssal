/**
 * WindowControls — 窗口控制按钮组（§3.3）
 *
 * 最小化 / 最大化(还原) / 关闭
 * 对齐 Windows 11 原生标题栏风格（46×32px）。
 * hover 效果通过 CSS 类实现（global.css 中定义）。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { getAPI } from '../../core/ipc/bridge';
import type { WindowMaximizedEvent } from '../../../shared-types/ipc';

const buttonSize: React.CSSProperties = {
  width: 46,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const api = getAPI();
    const unsub = api.app.window.onMaximizedChange(
      (event: WindowMaximizedEvent) => {
        setIsMaximized(event.isMaximized);
      }
    );
    return unsub;
  }, []);

  const handleMinimize = useCallback(() => {
    getAPI().app.window.minimize();
  }, []);

  const handleToggleMaximize = useCallback(() => {
    getAPI().app.window.toggleMaximize();
  }, []);

  const handleClose = useCallback(() => {
    getAPI().app.window.close();
  }, []);

  return (
    <div
      className="titlebar__interactive"
      style={{ display: 'flex', alignItems: 'center' }}
    >
      {/* 最小化 */}
      <button
        aria-label="最小化"
        className="window-ctrl-btn"
        style={buttonSize}
        onClick={handleMinimize}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Minus size={16} strokeWidth={1} />
      </button>

      {/* 最大化/还原 */}
      <button
        aria-label={isMaximized ? '还原' : '最大化'}
        className="window-ctrl-btn"
        style={buttonSize}
        onClick={handleToggleMaximize}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {isMaximized ? <Copy size={14} strokeWidth={1} /> : <Square size={14} strokeWidth={1} />}
      </button>

      {/* 关闭 */}
      <button
        aria-label="关闭"
        className="window-close-btn"
        style={buttonSize}
        onClick={handleClose}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <X size={16} strokeWidth={1} />
      </button>
    </div>
  );
}
