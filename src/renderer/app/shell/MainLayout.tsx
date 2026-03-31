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

import React, { useRef, useCallback, useEffect } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { TitleBar } from './TitleBar';
import { NavRail } from './NavRail';
import { MainStage } from './MainStage';
import { StatusBar } from './StatusBar';
import { GlobalSearch } from './GlobalSearch';
import { DndProvider } from './DndProvider';
import { ContextPanel } from '../../panels/context/ContextPanel';
import { WorkflowMonitor } from '../../panels/WorkflowMonitor';
import { useAppStore } from '../../core/store';
import { useShallow } from 'zustand/react/shallow';
import { useHotkey } from '../../core/hooks/useHotkey';
import { useResponsivePanel } from '../../core/hooks/useResponsivePanel';

const resizeHandleVisibleStyle: React.CSSProperties = { visibility: 'visible' };
const resizeHandleHiddenStyle: React.CSSProperties = { visibility: 'hidden', width: 0 };

const layoutSelector = (s: ReturnType<typeof useAppStore.getState>) => ({
  taskPanelOpen: s.taskPanelOpen,
  contextPanelOpen: s.contextPanelOpen,
  contextPanelSize: s.contextPanelSize,
  toggleContextPanel: s.toggleContextPanel,
  setContextPanelLastSize: s.setContextPanelLastSize,
  switchView: s.switchView,
});

export function MainLayout() {
  const {
    taskPanelOpen, contextPanelOpen, contextPanelSize,
    toggleContextPanel, setContextPanelLastSize, switchView,
  } = useAppStore(useShallow(layoutSelector));

  const workspaceRef = useRef<HTMLDivElement>(null);
  const contextPanelRef = useRef<ImperativePanelHandle>(null);

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
  const handleContextPanelCollapse = useCallback(() => {
    const currentSize = contextPanelRef.current?.getSize() ?? 0;
    if (currentSize > 0) {
      setContextPanelLastSize(currentSize);
    }
    useAppStore.setState({ contextPanelOpen: false, contextPanelSize: 0 });
  }, [setContextPanelLastSize]);

  const handleContextPanelExpand = useCallback(() => {
    const lastSize = useAppStore.getState().contextPanelLastSize || 28;
    useAppStore.setState({ contextPanelOpen: true, contextPanelSize: lastSize });
  }, []);

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

  // Ctrl+1~5: 视图切换
  useHotkey('Ctrl+1', () => switchView('library'));
  useHotkey('Ctrl+2', () => switchView('reader'));
  useHotkey('Ctrl+3', () => switchView('analysis'));
  useHotkey('Ctrl+4', () => switchView('graph'));
  useHotkey('Ctrl+5', () => switchView('writing'));
  useHotkey('Ctrl+6', () => switchView('notes'));
  useHotkey('Ctrl+,', () => switchView('settings'));

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
          <PanelGroup direction="horizontal" autoSaveId="abyssal-workspace-v2">
            {/* MainStage Panel */}
            <Panel
              minSize={40}
              defaultSize={100 - contextPanelSize}
              order={1}
            >
              <MainStage />
            </Panel>

            {/* ResizeHandle — 始终渲染，折叠时隐藏样式 */}
            <PanelResizeHandle
              className="panel-resize-handle"
              style={contextPanelOpen ? resizeHandleVisibleStyle : resizeHandleHiddenStyle}
            />

            {/* ContextPanel — 始终渲染，由 collapsible API 控制折叠 */}
            <Panel
              ref={contextPanelRef}
              minSize={15}
              maxSize={40}
              defaultSize={contextPanelSize}
              collapsible
              collapsedSize={0}
              onCollapse={handleContextPanelCollapse}
              onExpand={handleContextPanelExpand}
              order={2}
            >
              {contextPanelOpen && <ContextPanel />}
            </Panel>
          </PanelGroup>
        </DndProvider>
      </div>

      {/* Bottom panel — 任务活动面板 */}
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
