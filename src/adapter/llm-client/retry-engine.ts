/**
 * Retry engine — exponential backoff with jitter, error classification,
 * Retry-After header parsing, and AbortSignal-aware sleeping.
 *
 * See spec: section 5 — Retry Engine
 */

// ─── Error classification ───

export interface ErrorClassification {
  code: string;
  retryable: boolean;
  maxRetries: number;
  /** If set, use this fixed delay instead of exponential backoff */
  fixedDelayMs?: number;
}

export function classifyError(error: unknown): ErrorClassification {
  // AbortError (user cancel)
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'USER_CANCELLED', retryable: false, maxRetries: 0 };
  }

  const err = error as Record<string, unknown>;
  const status = (err['status'] as number) ?? (err['statusCode'] as number) ?? 0;
  const code = (err['code'] as string) ?? '';

  // HTTP status-based classification
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true, maxRetries: 3 };
  if (status >= 500 && status <= 503) return { code: 'SERVER_ERROR', retryable: true, maxRetries: 3 };
  if (status === 504) return { code: 'GATEWAY_TIMEOUT', retryable: true, maxRetries: 2 };
  if (status === 400) return { code: 'BAD_REQUEST', retryable: false, maxRetries: 0 };
  if (status === 401 || status === 403) return { code: 'AUTH_ERROR', retryable: false, maxRetries: 0 };
  if (status === 413) return { code: 'PAYLOAD_TOO_LARGE', retryable: false, maxRetries: 0 };

  // Network error codes
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return { code: 'NETWORK_TIMEOUT', retryable: true, maxRetries: 1 };
  if (code === 'ECONNREFUSED') return { code: 'CONNECTION_REFUSED', retryable: true, maxRetries: 2, fixedDelayMs: 2000 };
  if (code === 'ENOTFOUND') return { code: 'DNS_FAILURE', retryable: false, maxRetries: 0 };

  // JSON parse errors
  if (error instanceof SyntaxError) return { code: 'JSON_PARSE_ERROR', retryable: true, maxRetries: 1, fixedDelayMs: 0 };

  // Check signal.aborted on the error object
  if (err['signal'] && (err['signal'] as AbortSignal).aborted) {
    return { code: 'USER_CANCELLED', retryable: false, maxRetries: 0 };
  }

  // Default: not retryable
  return { code: 'UNKNOWN', retryable: false, maxRetries: 0 };
}

// ─── Delay computation ───

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_BASE_DELAY = 2000;
const DEFAULT_MAX_DELAY = 30000;

/**
 * Compute delay with exponential backoff + uniform random jitter.
 *
 * delay(n) = min(baseDelay * 2^n + jitter(n), maxDelay)
 * jitter(n) = floor(random() * baseDelay)
 */
export function computeDelay(
  attempt: number,
  options?: BackoffOptions,
): number {
  const base = options?.baseDelayMs ?? DEFAULT_BASE_DELAY;
  const max = options?.maxDelayMs ?? DEFAULT_MAX_DELAY;
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * base);
  return Math.min(exponential + jitter, max);
}

/**
 * Parse Retry-After header value.
 * Returns delay in milliseconds, or null if unparseable.
 *
 * Formats:
 * - Integer seconds: "5" → 5000ms
 * - HTTP-date: "Wed, 25 Mar 2026 10:30:00 GMT" → (date - now)ms
 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;

  // Try as integer seconds
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds) && String(seconds) === value.trim()) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}

/**
 * Extract Retry-After from error response headers.
 */
function extractRetryAfter(error: unknown): number | null {
  const err = error as Record<string, unknown>;
  // Anthropic SDK: error.headers['retry-after']
  const headers = err['headers'] as Record<string, string> | undefined;
  if (headers) {
    return parseRetryAfter(headers['retry-after'] ?? headers['Retry-After']);
  }
  // OpenAI SDK: error.response?.headers
  const response = err['response'] as Record<string, unknown> | undefined;
  if (response?.['headers']) {
    const rh = response['headers'] as Record<string, string>;
    return parseRetryAfter(rh['retry-after'] ?? rh['Retry-After']);
  }
  return null;
}

// ─── Sleep with AbortSignal ───

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// ─── Retryable call ───

export interface RetryOptions extends BackoffOptions {
  maxRetries?: number;
  signal?: AbortSignal;
  model?: string;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/**
 * Execute an async function with automatic retry on transient errors.
 *
 * Uses exponential backoff with jitter. Respects Retry-After headers for 429s.
 * Honors AbortSignal for cancellation during sleep.
 */
export async function retryableCall<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const classification = classifyError(error);

      if (!classification.retryable) throw error;

      const effectiveMax = Math.min(maxRetries, classification.maxRetries);
      if (attempt >= effectiveMax) throw error;

      // Compute delay: Retry-After takes priority over exponential backoff
      let delayMs: number;
      if (classification.code === 'RATE_LIMITED') {
        const retryAfter = extractRetryAfter(error);
        delayMs = retryAfter ?? computeDelay(attempt, options);
      } else if (classification.fixedDelayMs !== undefined) {
        delayMs = classification.fixedDelayMs;
      } else {
        delayMs = computeDelay(attempt, options);
      }

      options?.onRetry?.(attempt + 1, delayMs, error);

      await sleep(delayMs, options?.signal);
    }
  }

  throw lastError;
}
