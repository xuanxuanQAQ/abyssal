/**
 * useResponsivePanel — 自适应面板管理（§2.3）
 *
 * 三层自适应策略：
 * 1. CSS Media Queries（纯样式层面）— 在 global.css 中定义
 * 2. ResizeObserver 监听 workspace 容器（本 Hook）
 * 3. requestAnimationFrame 帧对齐调度
 *
 * 当 ContextPanel 的计算像素值 < 240px 时，
 * 自动触发折叠（snap to 0%）。
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';

export interface UseResponsivePanelOptions {
  /** workspace 容器的 ref */
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  /** ContextPanel 的 imperative handle */
  contextPanelRef: React.RefObject<ImperativePanelHandle | null>;
  /** 当前 ContextPanel 百分比尺寸 */
  contextPanelSize: number;
  /** ContextPanel 是否打开 */
  contextPanelOpen: boolean;
  /** 折叠 ContextPanel 的回调 */
  onCollapse: () => void;
}

/**
 * 自适应面板折叠的最小像素阈值
 */
const MIN_CONTEXT_PANEL_PX = 120;

export function useResponsivePanel({
  workspaceRef,
  contextPanelRef,
  contextPanelSize,
  contextPanelOpen,
  onCollapse,
}: UseResponsivePanelOptions): void {
  const rafIdRef = useRef<number>(0);
  const lastSizeRef = useRef(contextPanelSize);
  lastSizeRef.current = contextPanelSize;

  const checkAndCollapse = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !contextPanelOpen) return;

    const workspaceWidth = workspace.offsetWidth;
    const panelPixels = (lastSizeRef.current / 100) * workspaceWidth;

    if (panelPixels > 0 && panelPixels < MIN_CONTEXT_PANEL_PX) {
      // 像素低于阈值，自动折叠
      const panel = contextPanelRef.current;
      if (panel) {
        panel.collapse();
      }
      onCollapse();
    }
  }, [workspaceRef, contextPanelRef, contextPanelOpen, onCollapse]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const observer = new ResizeObserver(() => {
      // 第三层：rAF 帧对齐调度
      // 同一帧内多次触发只执行最后一次
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        checkAndCollapse();
      });
    });

    observer.observe(workspace);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [workspaceRef, checkAndCollapse]);
}
