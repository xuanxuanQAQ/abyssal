/**
 * peekController — Peek 机制的计时器管理（§2.4 v1.1）
 *
 * 双重约束触发：
 * 约束 1：Alt 修饰键激活。Peek 仅在用户按住 Alt 键的同时悬停实体时启动 800ms 倒计时。
 * 约束 2：焦点保护。当 ChatInput 拥有焦点时，无条件禁止 Peek 触发。
 *
 * 使用方式：各视图的实体行组件调用 peekController 的方法注册/注销 Peek 意图。
 */

import { useAppStore } from '../../../core/store';
import type { ContextSource } from '../../../../shared-types/models';

const PEEK_DELAY_MS = 800;
const PEEK_RESTORE_DELAY_MS = 500;

let peekTimerId: ReturnType<typeof setTimeout> | undefined;
let restoreTimerId: ReturnType<typeof setTimeout> | undefined;

/**
 * 检查 ChatInput 是否拥有焦点
 */
function isChatInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.getAttribute('data-chat-input') === 'true';
}

/**
 * 开始 Peek 倒计时（需 Alt 键按下 + 非 ChatInput 焦点）
 */
export function startPeek(source: ContextSource, altKeyDown: boolean): void {
  // 清除恢复计时器
  clearTimeout(restoreTimerId);

  if (!altKeyDown || isChatInputFocused()) {
    return;
  }

  const state = useAppStore.getState();
  if (!state.contextPanelPinned) return;

  clearTimeout(peekTimerId);
  peekTimerId = setTimeout(() => {
    // 二次检查
    if (isChatInputFocused()) return;
    useAppStore.getState().setPeekSource(source);
  }, PEEK_DELAY_MS);
}

/**
 * 取消 Peek 倒计时 / 延迟恢复钉住内容
 */
export function cancelPeek(): void {
  clearTimeout(peekTimerId);

  const state = useAppStore.getState();
  if (state.peekSource !== null) {
    // 鼠标移出后 500ms 延迟恢复
    restoreTimerId = setTimeout(() => {
      useAppStore.getState().setPeekSource(null);
    }, PEEK_RESTORE_DELAY_MS);
  }
}

/**
 * 立即清除所有 Peek 状态
 */
export function clearPeek(): void {
  clearTimeout(peekTimerId);
  clearTimeout(restoreTimerId);
  useAppStore.getState().setPeekSource(null);
}
