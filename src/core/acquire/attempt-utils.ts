// ═══ Acquire Attempt 统一工具 ═══
// 错误分类 + 重试策略 + AcquireAttempt 构造

import type { AcquireAttempt, FailureCategory } from '../types';
import {
  TimeoutError,
  RateLimitedError,
  ServerError,
  AccessDeniedError,
  NetworkError,
} from '../types/errors';
import { deleteFileIfExists } from './downloader';

// ─── 错误分类 ───

/** 从捕获的异常中推断 FailureCategory */
export function classifyError(err: unknown): {
  category: FailureCategory;
  retryable: boolean;
  httpStatus: number | null;
} {
  if (err instanceof TimeoutError) {
    return { category: 'timeout', retryable: true, httpStatus: null };
  }
  if (err instanceof RateLimitedError) {
    return { category: 'rate_limited', retryable: false, httpStatus: 429 };
  }
  if (err instanceof AccessDeniedError) {
    return { category: 'http_4xx', retryable: false, httpStatus: 403 };
  }
  if (err instanceof ServerError) {
    const status = (err.context?.['status'] as number) ?? 500;
    return { category: 'http_5xx', retryable: true, httpStatus: status };
  }
  if (err instanceof NetworkError) {
    const msg = err.message.toLowerCase();
    const status = (err.context?.['status'] as number) ?? null;

    // HTTP 4xx
    if (status && status >= 400 && status < 500) {
      return { category: 'http_4xx', retryable: false, httpStatus: status };
    }
    // HTTP 5xx
    if (status && status >= 500) {
      return { category: 'http_5xx', retryable: true, httpStatus: status };
    }
    // DNS
    if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
      return { category: 'dns_error', retryable: false, httpStatus: null };
    }
    // Connection reset
    if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('epipe')) {
      return { category: 'connection_reset', retryable: true, httpStatus: null };
    }
    // SSL
    if (msg.includes('ssl') || msg.includes('tls') || msg.includes('cert')) {
      return { category: 'ssl_error', retryable: false, httpStatus: null };
    }

    return { category: 'unknown', retryable: true, httpStatus: status };
  }

  // 非框架异常
  const msg = (err as Error)?.message?.toLowerCase() ?? '';
  if (msg.includes('enotfound') || msg.includes('getaddrinfo')) {
    return { category: 'dns_error', retryable: false, httpStatus: null };
  }
  if (msg.includes('econnreset') || msg.includes('econnrefused')) {
    return { category: 'connection_reset', retryable: true, httpStatus: null };
  }
  if (msg.includes('timeout') || msg.includes('abort')) {
    return { category: 'timeout', retryable: true, httpStatus: null };
  }

  return { category: 'unknown', retryable: false, httpStatus: null };
}

// ─── AcquireAttempt 构造器 ───

export function makeAttempt(
  source: string,
  status: AcquireAttempt['status'],
  durationMs: number,
  opts: {
    failureReason?: string | null;
    failureCategory?: FailureCategory | null;
    httpStatus?: number | null;
  } = {},
): AcquireAttempt {
  return {
    source,
    status,
    durationMs,
    failureReason: opts.failureReason ?? null,
    failureCategory: opts.failureCategory ?? null,
    httpStatus: opts.httpStatus ?? null,
  };
}

/** 从异常构造失败 AcquireAttempt */
export function makeFailedAttempt(
  source: string,
  start: number,
  err: unknown,
): AcquireAttempt {
  const classified = classifyError(err);
  return makeAttempt(
    source,
    classified.category === 'timeout' ? 'timeout' : 'failed',
    Date.now() - start,
    {
      failureReason: (err as Error)?.message ?? 'Unknown error',
      failureCategory: classified.category,
      httpStatus: classified.httpStatus,
    },
  );
}

// ─── 带重试的 source adapter 执行器 ───

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * 执行 source adapter 函数，对可重试错误自动重试。
 * 返回最终的 AcquireAttempt。
 */
export async function withRetry(
  source: string,
  tempPath: string,
  retryConfig: RetryConfig,
  fn: () => Promise<AcquireAttempt>,
): Promise<AcquireAttempt> {
  let lastAttempt: AcquireAttempt | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    if (attempt > 0) {
      // 重试前等待
      await new Promise((r) => setTimeout(r, retryConfig.retryDelayMs));
      deleteFileIfExists(tempPath);
    }

    lastAttempt = await fn();

    if (lastAttempt.status === 'success' || lastAttempt.status === 'skipped') {
      return lastAttempt;
    }

    // 检查是否可重试
    const classified = lastAttempt.failureCategory
      ? { retryable: isRetryableCategory(lastAttempt.failureCategory) }
      : { retryable: false };

    if (!classified.retryable || attempt >= retryConfig.maxRetries) {
      return lastAttempt;
    }
  }

  return lastAttempt!;
}

function isRetryableCategory(category: FailureCategory): boolean {
  return category === 'timeout' || category === 'http_5xx' || category === 'connection_reset';
}
