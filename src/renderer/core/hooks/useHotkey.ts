/**
 * useHotkey — 自定义快捷键 Hook（§7）
 *
 * 三层优先级系统：
 * Layer 3 (Component Local) > Layer 2 (View Scoped) > Layer 1 (Global)
 *
 * Windows 专用修饰键映射。
 * 输入框保护规则：焦点在 input/textarea/contenteditable 时，
 * 仅 Ctrl+*、Escape、Ctrl+Shift+* 穿透。
 */

import { useEffect, useRef, useCallback } from 'react';
import { useViewActive } from '../context/ViewActiveContext';

/**
 * 解析快捷键字符串为匹配条件
 *
 * 格式示例：'Ctrl+Shift+A', 'Escape', 'Ctrl+Enter', 'H', 'Ctrl+Plus'
 */
interface ParsedHotkey {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
}

function parseHotkey(combo: string): ParsedHotkey {
  const tokens = combo.split('+');
  const modifiers = tokens.slice(0, -1).map((t) => t.toLowerCase());
  let mainKey = tokens[tokens.length - 1] ?? '';

  // §7.6 修饰键映射
  const ctrlKey = modifiers.includes('ctrl');
  const shiftKey = modifiers.includes('shift');
  const altKey = modifiers.includes('alt');

  // 特殊键名映射
  switch (mainKey) {
    case 'Plus':
      mainKey = '=';
      break;
    case 'Minus':
      mainKey = '-';
      break;
    case 'Escape':
    case 'Enter':
    case 'Space':
    case 'Delete':
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Tab':
      // 保持原样（event.key 匹配）
      break;
    case ',':
      // Ctrl+, — 逗号键
      break;
    default:
      // 字母/数字统一小写
      mainKey = mainKey.toLowerCase();
      break;
  }

  return { ctrlKey, shiftKey, altKey, key: mainKey };
}

function matchesHotkey(event: KeyboardEvent, parsed: ParsedHotkey): boolean {
  if (event.ctrlKey !== parsed.ctrlKey) return false;
  if (event.shiftKey !== parsed.shiftKey) return false;
  if (event.altKey !== parsed.altKey) return false;

  const eventKey = event.key.length === 1
    ? event.key.toLowerCase()
    : event.key;

  return eventKey === parsed.key;
}

/**
 * §7.2 输入框保护规则
 *
 * 当焦点在 input/textarea/contenteditable 内时，
 * 仅以下快捷键穿透：
 * - 带 Ctrl 修饰的快捷键
 * - Escape
 * - 带 Ctrl+Shift 的快捷键
 */
function isInInputContext(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (!target) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  if (target.isContentEditable) return true;

  return false;
}

function shouldPassThroughInInput(parsed: ParsedHotkey): boolean {
  // Ctrl+* 始终响应
  if (parsed.ctrlKey) return true;
  // Escape 始终响应
  if (parsed.key === 'Escape') return true;
  return false;
}

export interface UseHotkeyOptions {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 绑定到特定元素（默认 document） */
  element?: HTMLElement | null;
  /** 匹配后是否 preventDefault（默认 true） */
  preventDefault?: boolean;
  /** 匹配后是否 stopPropagation（默认 false） */
  stopPropagation?: boolean;
}

/**
 * 注册单个快捷键的 Hook
 *
 * @param keyCombo 快捷键字符串，如 'Ctrl+K'
 * @param callback 触发时的回调
 * @param options 配置项
 */
export function useHotkey(
  keyCombo: string,
  callback: (event: KeyboardEvent) => void,
  options: UseHotkeyOptions = {}
): void {
  const {
    enabled = true,
    element = null,
    preventDefault = true,
    stopPropagation = false,
  } = options;
  const viewActive = useViewActive();

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const parsedRef = useRef<ParsedHotkey>(parseHotkey(keyCombo));

  // 当 keyCombo 变化时重新解析
  useEffect(() => {
    parsedRef.current = parseHotkey(keyCombo);
  }, [keyCombo]);

  const handler = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      if (!viewActive) return;

      const parsed = parsedRef.current;
      if (!matchesHotkey(event, parsed)) return;

      // 输入框保护
      if (isInInputContext(event) && !shouldPassThroughInInput(parsed)) {
        return;
      }

      if (preventDefault) {
        event.preventDefault();
      }
      if (stopPropagation) {
        event.stopPropagation();
      }

      callbackRef.current(event);
    },
    [enabled, preventDefault, stopPropagation, viewActive]
  );

  useEffect(() => {
    const target = element ?? document;
    target.addEventListener('keydown', handler as EventListener);
    return () => {
      target.removeEventListener('keydown', handler as EventListener);
    };
  }, [handler, element]);
}

/**
 * 批量注册快捷键
 *
 * @param bindings 快捷键 → 回调的映射
 * @param options 共享配置项
 */
export function useHotkeys(
  bindings: Record<string, (event: KeyboardEvent) => void>,
  options: UseHotkeyOptions = {}
): void {
  const {
    enabled = true,
    element = null,
    preventDefault = true,
    stopPropagation = false,
  } = options;
  const viewActive = useViewActive();

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const parsedBindingsRef = useRef<Array<{ parsed: ParsedHotkey; key: string }>>([]);

  useEffect(() => {
    parsedBindingsRef.current = Object.keys(bindings).map((combo) => ({
      parsed: parseHotkey(combo),
      key: combo,
    }));
  }, [bindings]);

  const handler = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;
      if (!viewActive) return;

      for (const { parsed, key } of parsedBindingsRef.current) {
        if (!matchesHotkey(event, parsed)) continue;

        if (isInInputContext(event) && !shouldPassThroughInInput(parsed)) {
          continue;
        }

        if (preventDefault) event.preventDefault();
        if (stopPropagation) event.stopPropagation();

        bindingsRef.current[key]?.(event);
        return; // 只执行第一个匹配
      }
    },
    [enabled, preventDefault, stopPropagation, viewActive]
  );

  useEffect(() => {
    const target = element ?? document;
    target.addEventListener('keydown', handler as EventListener);
    return () => {
      target.removeEventListener('keydown', handler as EventListener);
    };
  }, [handler, element]);
}
