import { describe, it, expect, vi } from 'vitest';
import {
  classifyError,
  computeDelay,
  parseRetryAfter,
  retryableCall,
} from './retry-engine';

// ─── classifyError ───

describe('classifyError', () => {
  it('classifies HTTP 429 as retryable RATE_LIMITED', () => {
    const err = { status: 429 };
    const c = classifyError(err);
    expect(c.code).toBe('RATE_LIMITED');
    expect(c.retryable).toBe(true);
    expect(c.maxRetries).toBe(3);
  });

  it('classifies HTTP 500-503 as retryable SERVER_ERROR', () => {
    for (const status of [500, 501, 502, 503]) {
      const c = classifyError({ status });
      expect(c.retryable).toBe(true);
      expect(c.code).toBe('SERVER_ERROR');
    }
  });

  it('classifies HTTP 504 as retryable GATEWAY_TIMEOUT', () => {
    const c = classifyError({ status: 504 });
    expect(c.code).toBe('GATEWAY_TIMEOUT');
    expect(c.retryable).toBe(true);
    expect(c.maxRetries).toBe(2);
  });

  it('classifies HTTP 400 as non-retryable BAD_REQUEST', () => {
    const c = classifyError({ status: 400 });
    expect(c.code).toBe('BAD_REQUEST');
    expect(c.retryable).toBe(false);
  });

  it('classifies HTTP 401/403 as non-retryable AUTH_ERROR', () => {
    expect(classifyError({ status: 401 }).code).toBe('AUTH_ERROR');
    expect(classifyError({ status: 403 }).retryable).toBe(false);
  });

  it('classifies HTTP 413 as non-retryable PAYLOAD_TOO_LARGE', () => {
    const c = classifyError({ status: 413 });
    expect(c.retryable).toBe(false);
  });

  it('classifies ETIMEDOUT as retryable with 1 retry', () => {
    const c = classifyError({ code: 'ETIMEDOUT' });
    expect(c.retryable).toBe(true);
    expect(c.maxRetries).toBe(1);
  });

  it('classifies ECONNREFUSED as retryable with fixed 2s delay', () => {
    const c = classifyError({ code: 'ECONNREFUSED' });
    expect(c.retryable).toBe(true);
    expect(c.fixedDelayMs).toBe(2000);
  });

  it('classifies ENOTFOUND as non-retryable', () => {
    expect(classifyError({ code: 'ENOTFOUND' }).retryable).toBe(false);
  });

  it('classifies SyntaxError as retryable with 0ms delay', () => {
    const c = classifyError(new SyntaxError('Unexpected token'));
    expect(c.retryable).toBe(true);
    expect(c.fixedDelayMs).toBe(0);
  });

  it('classifies AbortError as non-retryable', () => {
    const c = classifyError(new DOMException('Aborted', 'AbortError'));
    expect(c.code).toBe('USER_CANCELLED');
    expect(c.retryable).toBe(false);
  });

  it('classifies unknown errors as non-retryable', () => {
    const c = classifyError(new Error('something'));
    expect(c.retryable).toBe(false);
  });
});

// ─── computeDelay ───

describe('computeDelay', () => {
  it('produces delay in expected range for attempt 0', () => {
    const delay = computeDelay(0, { baseDelayMs: 2000, maxDelayMs: 30000 });
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThan(4000); // 2000 + jitter < 2000
  });

  it('caps at maxDelay', () => {
    const delay = computeDelay(10, { baseDelayMs: 2000, maxDelayMs: 30000 });
    expect(delay).toBeLessThanOrEqual(30000);
  });

  it('doubles base each attempt', () => {
    // With jitter removed (seeded), base doubles: 2000, 4000, 8000, 16000
    // We can only verify the minimum bound increases
    const d0 = computeDelay(0, { baseDelayMs: 1000, maxDelayMs: 100000 });
    const d1 = computeDelay(1, { baseDelayMs: 1000, maxDelayMs: 100000 });
    // d1 base = 2000, d0 base = 1000 — d1 should generally be larger
    // (with jitter there's overlap, so we just check d1 min >= d0 min)
    expect(d1).toBeGreaterThanOrEqual(2000);
  });
});

// ─── parseRetryAfter ───

describe('parseRetryAfter', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('120')).toBe(120000);
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
  });

  it('parses HTTP-date format', () => {
    const future = new Date(Date.now() + 10000).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(11000);
  });

  it('returns null for garbage input', () => {
    expect(parseRetryAfter('not-a-date-or-number')).toBeNull();
  });
});

// ─── retryableCall ───

describe('retryableCall', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryableCall(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue('recovered');

    const result = await retryableCall(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(retryableCall(fn, { maxRetries: 3 })).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting max retries', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500 });
    await expect(retryableCall(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toEqual({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('calls onRetry callback with attempt info', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValue('ok');

    await retryableCall(fn, { maxRetries: 3, baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), { status: 429 });
  });

  it('respects AbortSignal during sleep', async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockRejectedValue({ status: 500 });

    setTimeout(() => ac.abort(), 50);

    await expect(
      retryableCall(fn, { maxRetries: 5, baseDelayMs: 5000, signal: ac.signal }),
    ).rejects.toThrow();
  });
});
