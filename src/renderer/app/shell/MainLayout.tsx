/**
 * MainLayout — CSS Grid 根布局 + react-resizable-panels（§2）
 *
 * 四区域 Grid：titlebar / navrail / workspace / statusbar
 *
 * workspace 内部使用 react-resizable-panels 分割
 * MainStage + ContextPanel（百分比制约束）。
 *
 * 包裹 @dnd-kit DndContext（§9.5）。
 */

import React, { startTransition, useRef, useCallback, useEffect } from 'react';
import {
  Panel,
  Group,
  Separator,
  usePanelRef,
} from 'react-resizable-panels';
import { TitleBar } from './TitleBar';
import { NavRail } from './NavRail';
import { MainStage } from './MainStage';
import { StatusBar } from './StatusBar';
import { GlobalSearch } from './GlobalSearch';
import { DndProvider } from './DndProvider';
import { ContextPanel } from '../../panels/context/ContextPanel';
import { WorkflowMonitor } from '../../panels/WorkflowMonitor';
import { ViewActiveContext } from '../../core/context/ViewActiveContext';
import { useAppStore } from '../../core/store';
import { useShallow } from 'zustand/react/shallow';
import { useHotkey } from '../../core/hooks/useHotkey';
import { useResponsivePanel } from '../../core/hooks/useResponsivePanel';

const resizeHandleVisibleStyle: React.CSSProperties = { visibility: 'visible' };
const resizeHandleCollapsedStyle: React.CSSProperties = {
  visibility: 'visible',
  opacity: 0.6,
};

function toPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value))}%`;
}

const layoutSelector = (s: ReturnType<typeof useAppStore.getState>) => ({
  taskPanelOpen: s.taskPanelOpen,
  contextPanelOpen: s.contextPanelOpen,
  contextPanelSize: s.contextPanelSize,
  toggleContextPanel: s.toggleContextPanel,
  setContextPanelLastSize: s.setContextPanelLastSize,
});

export function MainLayout() {
  const {
    taskPanelOpen, contextPanelOpen, contextPanelSize,
    toggleContextPanel, setContextPanelLastSize,
  } = useAppStore(useShallow(layoutSelector));

  // action 引用稳定，独立 selector 避免 useShallow 的无意义浅比较
  const switchView = useAppStore((s) => s.switchView);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const contextPanelRef = usePanelRef();

  // §2.3 自适应面板折叠
  useResponsivePanel({
    workspaceRef,
    contextPanelRef,
    contextPanelSize,
    contextPanelOpen,
    onCollapse: () => {
      if (contextPanelOpen) {
        toggleContextPanel();
      }
    },
  });

  // §2.3 折叠时从 Panel API 读取当前尺寸并保存
  const handleContextPanelResize = useCallback((size: { asPercentage: number; inPixels: number }) => {
    if (size.asPercentage === 0) {
      // collapsed
      useAppStore.setState({ contextPanelOpen: false, contextPanelSize: 0 });
    } else {
      // 当前拖拽得到的新尺寸即新的用户偏好
      setContextPanelLastSize(size.asPercentage);
      useAppStore.setState({
        contextPanelOpen: true,
        contextPanelSize: size.asPercentage,
      });
    }
  }, [setContextPanelLastSize]);

  // 同步 store → Panel API（处理来自 ContextHeader "关闭面板"等外部触发）
  useEffect(() => {
    const panel = contextPanelRef.current;
    if (!panel) return;
    if (contextPanelOpen && panel.isCollapsed()) {
      panel.expand();
    } else if (!contextPanelOpen && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [contextPanelOpen]);

  // ── 全局快捷键（§7.3 Layer 1）──

  // Ctrl+B: 折叠/展开 ContextPanel（通过 Panel API 驱动，onCollapse/onExpand 回调同步 store）
  useHotkey('Ctrl+B', () => {
    if (contextPanelOpen) {
      contextPanelRef.current?.collapse();
    } else {
      contextPanelRef.current?.expand();
    }
  });

  // Ctrl+1~6: 视图切换（transition 优先级，不阻塞用户输入）
  useHotkey('Ctrl+1', () => startTransition(() => switchView('library')));
  useHotkey('Ctrl+2', () => startTransition(() => switchView('reader')));
  useHotkey('Ctrl+3', () => startTransition(() => switchView('analysis')));
  useHotkey('Ctrl+4', () => startTransition(() => switchView('graph')));
  useHotkey('Ctrl+5', () => startTransition(() => switchView('writing')));
  useHotkey('Ctrl+6', () => startTransition(() => switchView('notes')));
  useHotkey('Ctrl+,', () => startTransition(() => switchView('settings')));

  // Ctrl+J: 展开/折叠任务面板
  const toggleTaskPanel = useAppStore((s) => s.toggleTaskPanel);
  useHotkey('Ctrl+J', () => toggleTaskPanel());

  // Escape: 关闭最上层弹层
  useHotkey('Escape', () => {
    const state = useAppStore.getState();
    if (state.taskPanelOpen) {
      state.toggleTaskPanel();
      return;
    }
    if (state.globalSearchOpen) {
      state.closeGlobalSearch();
    }
  });

  return (
    <div className="app-shell">
      {/* §3 TitleBar */}
      <TitleBar />

      {/* §4 NavRail */}
      <div className="app-shell__navrail">
        <NavRail />
      </div>

      {/* §2.2 Workspace */}
      <div className="app-shell__workspace" ref={workspaceRef}>
        <DndProvider>
          <Group orientation="horizontal">
            {/* MainStage Panel */}
            <Panel
              minSize="40%"
              defaultSize={toPercent(100 - contextPanelSize)}
            >
              <MainStage />
            </Panel>

            {/* Separator — 始终渲染，折叠时隐藏样式 */}
            <Separator
              className="panel-resize-handle"
              style={contextPanelOpen ? resizeHandleVisibleStyle : resizeHandleCollapsedStyle}
            />

            {/* ContextPanel — keep-alive：折叠时保持挂载(display:none)避免重建开销 */}
            <Panel
              panelRef={contextPanelRef}
              minSize="15%"
              maxSize="40%"
              defaultSize={toPercent(contextPanelSize)}
              collapsible
              collapsedSize="0%"
              onResize={handleContextPanelResize}
            >
              <ViewActiveContext.Provider value={contextPanelOpen}>
                <div style={{ display: contextPanelOpen ? 'contents' : 'none' }}>
                  <ContextPanel />
                </div>
              </ViewActiveContext.Provider>
            </Panel>
          </Group>
        </DndProvider>
      </div>

      {/* 浮动任务活动面板 */}
      {taskPanelOpen && (
        <div className="app-shell__bottompanel">
          <WorkflowMonitor />
        </div>
      )}

      {/* §6 StatusBar */}
      <StatusBar />

      {/* §8 GlobalSearch (Portal-like, rendered at shell level) */}
      <GlobalSearch />
    </div>
  );
}
