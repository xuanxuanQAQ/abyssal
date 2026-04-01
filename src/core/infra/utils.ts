// ═══ 通用工具函数 ═══

/** 判断值是否为"空"——null / undefined / 空字符串 / 空数组 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
