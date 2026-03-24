/**
 * 错误分级处理逻辑
 *
 * 根据错误严重度决定 UI 反馈方式：
 * - info: toast 3秒自动消失
 * - warning: toast + StatusBar 持续显示
 * - error: ContextPanel 内联或 Dialog
 * - fatal: Error Boundary 全屏降级
 */

import toast from 'react-hot-toast';
import {
  type AbyssalError,
  type ErrorSeverity,
  classifyError,
  isAbyssalError,
} from './types';

/**
 * 将未知错误归一化为 AbyssalError
 */
export function normalizeError(err: unknown): AbyssalError {
  if (isAbyssalError(err)) return err;

  if (err instanceof Error) {
    return {
      code: 'INTERNAL_UNKNOWN',
      message: err.message,
      retryable: false,
    };
  }

  return {
    code: 'INTERNAL_UNKNOWN',
    message: String(err),
    retryable: false,
  };
}

/**
 * 根据错误严重度推送对应的 UI 反馈
 */
export function handleError(err: unknown): void {
  const abyssalErr = normalizeError(err);
  const severity = classifyError(abyssalErr.code);
  showErrorUI(abyssalErr, severity);
}

function showErrorUI(err: AbyssalError, severity: ErrorSeverity): void {
  const msg = err.message;

  switch (severity) {
    case 'info':
      toast(msg, { duration: 3000 });
      break;
    case 'warning':
      toast(msg, { duration: 6000, icon: '\u26A0' });
      break;
    case 'error':
      toast.error(msg, { duration: 8000 });
      break;
    case 'fatal':
      // fatal 错误交由 Error Boundary 处理
      // 此处仅记录日志
      console.error(`[FATAL] ${err.code}: ${msg}`, err.details);
      break;
  }
}

/**
 * TanStack Query 的 retry 判断函数
 * 只有 retryable === true 的错误才重试
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const abyssalErr = normalizeError(error);
  return abyssalErr.retryable && failureCount < 3;
}

/**
 * TanStack Query 的 retryDelay 函数
 * 指数退避，上限 30 秒
 */
export function getRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}
