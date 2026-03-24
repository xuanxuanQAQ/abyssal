/**
 * 错误类型定义
 *
 * 所有 IPC 调用可能返回的错误统一结构体，
 * 按可恢复性和用户感知分级。
 */

export interface AbyssalError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  retryAfterMs?: number;
}

/** 错误严重度 */
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';

/** 错误类别前缀 → 严重度映射 */
export function classifyError(code: string): ErrorSeverity {
  if (code.startsWith('VALIDATION_')) return 'warning';
  if (code.startsWith('NOT_FOUND_')) return 'error';
  if (code.startsWith('EXTERNAL_')) return 'warning';
  if (code.startsWith('FS_')) return 'error';
  if (code.startsWith('INTERNAL_')) return 'fatal';
  return 'error';
}

/**
 * 判断一个未知错误是否为 AbyssalError 结构体
 */
export function isAbyssalError(err: unknown): err is AbyssalError {
  if (typeof err !== 'object' || err === null) return false;
  const obj = err as Record<string, unknown>;
  return (
    typeof obj['code'] === 'string' &&
    typeof obj['message'] === 'string' &&
    typeof obj['retryable'] === 'boolean'
  );
}
