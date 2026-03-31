/**
 * formatRelativeTime — 共享的相对时间格式化工具
 *
 * 统一 WorkflowMonitor / ChatSessionList 等处的时间格式化逻辑。
 * 使用 i18n t() 进行本地化。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: string, opts?: any) => string;

/**
 * 将 Unix 时间戳格式化为相对时间字符串。
 * 使用 `common.justNow` / `common.minutesAgo` / `common.hoursAgo` / `common.daysAgo` i18n keys。
 */
export function formatRelativeTime(timestamp: number, t: TFn): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('common.justNow');
  if (minutes < 60) return t('common.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.hoursAgo', { count: hours });
  return t('common.daysAgo', { count: Math.floor(hours / 24) });
}

/**
 * 将 ISO 日期字符串格式化为相对时间或绝对日期。
 * 超过 24 小时显示 M/D HH:mm（同年）或 toLocaleDateString（跨年）。
 */
export function formatRelativeDate(isoDate: string, t: TFn): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return t('common.justNow');
  if (diffMin < 60) return t('common.minutesAgo', { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('common.hoursAgo', { count: diffHr });

  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return d.toLocaleDateString();
}
