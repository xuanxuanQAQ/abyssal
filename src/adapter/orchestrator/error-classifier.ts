/**
 * Unified error classification, retry logic, and circuit breaker.
 *
 * Shared across discover / acquire / bibliography workflows.
 * - classifyError: maps Error → ErrorCategory with retryable flag
 * - withRetry: wraps async fn with exponential backoff (max 3 attempts)
 * - CircuitBreaker: halts batch processing after 10 consecutive same-category failures
 *
 * See spec: §7
 */

import {
  AbyssalError,
  RateLimitedError,
  AuthenticationError,
  AccessDeniedError,
  PaperNotFoundError,
  PdfCorruptedError,
  YamlParseError,
  ParseError,
  DatabaseError,
  IntegrityError,
  NetworkError,
} from '../../core/types/errors';

// ─── Error categories (§7.1) ───

export type ErrorCategory =
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PARSE_ERROR'
  | 'DISK_ERROR'
  | 'DB_ERROR'
  | 'UNKNOWN';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
  original: Error;
}

/**
 * Extract HTTP status code from error objects (various libraries use different field names).
 */
function extractHttpStatus(err: Error): number | undefined {
  const e = err as unknown as Record<string, unknown>;
  const status = e['statusCode'] ?? e['status'] ?? e['httpStatus'];
  if (typeof status === 'number' && status >= 100 && status < 600) return status;
  // AbyssalError may carry httpStatus in context
  if (err instanceof AbyssalError) {
    const ctx = err.context['httpStatus'];
    if (typeof ctx === 'number') return ctx;
  }
  return undefined;
}

/**
 * Classify an error into a category with retryability.
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const msg = err.message.toLowerCase();
  const code = (err as NodeJS.ErrnoException).code ?? '';
  const httpStatus = extractHttpStatus(err);

  // ── instanceof-based classification (preferred — survives minification) ──

  if (err instanceof RateLimitedError) {
    return { category: 'RATE_LIMITED', retryable: true, message: err.message, original: err };
  }
  if (err instanceof AuthenticationError || err instanceof AccessDeniedError) {
    return { category: 'AUTH_ERROR', retryable: false, message: err.message, original: err };
  }
  if (err instanceof PaperNotFoundError) {
    return { category: 'NOT_FOUND', retryable: false, message: err.message, original: err };
  }
  if (err instanceof PdfCorruptedError) {
    return { category: 'VALIDATION_ERROR', retryable: false, message: err.message, original: err };
  }
  if (err instanceof YamlParseError || err instanceof ParseError) {
    return { category: 'PARSE_ERROR', retryable: false, message: err.message, original: err };
  }
  if (err instanceof IntegrityError || err instanceof DatabaseError) {
    return { category: 'DB_ERROR', retryable: false, message: err.message, original: err };
  }
  if (err instanceof NetworkError) {
    return { category: 'NETWORK_ERROR', retryable: true, message: err.message, original: err };
  }

  // ── HTTP status code classification (structured — more reliable than string matching) ──

  if (httpStatus) {
    if (httpStatus === 429) {
      return { category: 'RATE_LIMITED', retryable: true, message: err.message, original: err };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { category: 'AUTH_ERROR', retryable: false, message: err.message, original: err };
    }
    if (httpStatus === 404) {
      return { category: 'NOT_FOUND', retryable: false, message: err.message, original: err };
    }
    if (httpStatus >= 500) {
      return { category: 'NETWORK_ERROR', retryable: true, message: err.message, original: err };
    }
  }

  // ── System error codes ──

  // Disk errors — fatal, never retry (§7.2)
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EROFS') {
    return { category: 'DISK_ERROR', retryable: false, message: err.message, original: err };
  }

  // Network errors — retryable
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ECONNRESET' ||
      code === 'ENOTFOUND' || code === 'EPIPE' || msg.includes('timeout') ||
      msg.includes('network') || msg.includes('socket hang up')) {
    return { category: 'NETWORK_ERROR', retryable: true, message: err.message, original: err };
  }

  // ── String-based fallback (for third-party errors not wrapped in AbyssalError) ──

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return { category: 'RATE_LIMITED', retryable: true, message: err.message, original: err };
  }

  // Auth
  if (msg.includes('unauthorized') || msg.includes('forbidden')) {
    return { category: 'AUTH_ERROR', retryable: false, message: err.message, original: err };
  }

  // Validation
  if (msg.includes('pdf') && (msg.includes('invalid') || msg.includes('corrupt') || msg.includes('validation'))) {
    return { category: 'VALIDATION_ERROR', retryable: false, message: err.message, original: err };
  }

  // Parse
  if (msg.includes('parse error') || msg.includes('yaml parse') || msg.includes('json parse')) {
    return { category: 'PARSE_ERROR', retryable: false, message: err.message, original: err };
  }

  // DB
  if (msg.includes('sqlite') || msg.includes('database') || msg.includes('busy')) {
    return { category: 'DB_ERROR', retryable: false, message: err.message, original: err };
  }

  return { category: 'UNKNOWN', retryable: false, message: err.message, original: err };
}

// ─── Retry with exponential backoff ───

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: ClassifiedError) => void;
}

/**
 * Execute an async function with retry on retryable errors.
 * Exponential backoff: baseDelay * 2^(attempt-1), max 3 attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  let lastError: ClassifiedError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = classifyError(err);

      // Disk errors are always fatal — rethrow immediately (§7.2)
      if (lastError.category === 'DISK_ERROR') {
        throw lastError.original;
      }

      if (!lastError.retryable || attempt >= maxAttempts) {
        throw lastError.original;
      }

      options.onRetry?.(attempt, lastError);

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError?.original ?? new Error('withRetry: exhausted attempts');
}

// ─── Circuit breaker (§7.3) ───

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private lastCategory: ErrorCategory | null = null;
  private readonly threshold: number;

  constructor(threshold: number = 10) {
    this.threshold = threshold;
  }

  /**
   * Record a success — resets the consecutive failure counter.
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastCategory = null;
  }

  /**
   * Record a failure. If consecutive same-category failures reach
   * the threshold, throws CircuitBreakerTripped.
   */
  recordFailure(error: unknown): void {
    const classified = classifyError(error);

    if (classified.category === this.lastCategory) {
      this.consecutiveFailures++;
    } else {
      this.consecutiveFailures = 1;
      this.lastCategory = classified.category;
    }

    if (this.consecutiveFailures >= this.threshold) {
      throw new CircuitBreakerTripped(this.lastCategory!, this.consecutiveFailures);
    }
  }

  get failures(): number {
    return this.consecutiveFailures;
  }
}

export class CircuitBreakerTripped extends Error {
  readonly category: ErrorCategory;
  readonly consecutiveFailures: number;

  constructor(category: ErrorCategory, consecutiveFailures: number) {
    super(
      `Circuit breaker tripped: ${consecutiveFailures} consecutive ${category} failures`,
    );
    this.name = 'CircuitBreakerTripped';
    this.category = category;
    this.consecutiveFailures = consecutiveFailures;
  }
}
