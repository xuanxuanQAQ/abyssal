/**
 * z-index 层级常量（§12）
 *
 * 全局统一管理，避免 z-index 混乱。
 * CSS 中不硬编码 z-index，由组件通过内联 style 引用此处常量。
 */

export const Z_INDEX = {
  BASE: 0,
  PANEL_RESIZE_HANDLE: 10,
  STICKY_HEADER: 15,
  NAV_RAIL: 20,
  /** 编辑器浮动工具栏与图控件互斥，共享层级 */
  FLOATING_TOOLBAR: 25,
  GRAPH_CONTROLS: 25,
  CONTEXT_MENU: 28,
  POPOVER: 30,
  DROPDOWN: 35,
  TOOLTIP: 40,
  TOAST: 50,
  MODAL_BACKDROP: 60,
  MODAL: 65,
  DRAG_OVERLAY: 100,
} as const;

export type ZIndexLayer = keyof typeof Z_INDEX;
