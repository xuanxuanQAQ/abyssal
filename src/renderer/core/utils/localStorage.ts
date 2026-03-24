/**
 * localStorage 持久化工具函数
 *
 * 统一 Context 层的 load/save 模式，消除三份重复的 try-catch 代码。
 */

/**
 * 从 localStorage 加载并解析 JSON，失败时返回默认值
 */
export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // corrupt data — 静默回退到默认值
  }
  return fallback;
}

/**
 * 将值序列化为 JSON 并存入 localStorage
 */
export function saveToStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
