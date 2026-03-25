import { RateLimiter } from './rate-limiter';

// ---------------------------------------------------------------------------
// 1. Initial capacity: tryAcquire succeeds `capacity` times then fails
// ---------------------------------------------------------------------------
describe('RateLimiter', () => {
  it('tryAcquire succeeds exactly `capacity` times then fails', () => {
    const limiter = new RateLimiter(2, 0.0001);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 2. acquire() resolves immediately when tokens are available
  // -----------------------------------------------------------------------
  it('acquire resolves immediately when tokens are available', async () => {
    const limiter = new RateLimiter(5, 0.0001);

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should resolve within a few ms — certainly under 50 ms.
    expect(elapsed).toBeLessThan(50);
  });

  // -----------------------------------------------------------------------
  // 3. freeze(): tryAcquire returns false during freeze
  // -----------------------------------------------------------------------
  it('tryAcquire returns false while the limiter is frozen', () => {
    const limiter = new RateLimiter(10, 1);
    limiter.freeze(10_000);

    expect(limiter.tryAcquire()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 4. parseRetryAfter: numeric string "5" → 5 000 ms
  // -----------------------------------------------------------------------
  it('parseRetryAfter converts a numeric-second string to milliseconds', () => {
    expect(RateLimiter.parseRetryAfter('5', 1000)).toBe(5000);
  });

  // -----------------------------------------------------------------------
  // 5. parseRetryAfter: null / undefined → defaultMs
  // -----------------------------------------------------------------------
  it.each([null, undefined])(
    'parseRetryAfter returns defaultMs when header is %s',
    (header) => {
      expect(RateLimiter.parseRetryAfter(header, 7777)).toBe(7777);
    },
  );

  // -----------------------------------------------------------------------
  // 6. parseRetryAfter: HTTP-date → milliseconds until that time
  // -----------------------------------------------------------------------
  it('parseRetryAfter parses an HTTP-date header', () => {
    const futureDate = new Date(Date.now() + 30_000);
    const httpDate = futureDate.toUTCString(); // e.g. "Wed, 25 Mar 2026 …"

    const result = RateLimiter.parseRetryAfter(httpDate, 1000);

    // The result should be roughly 30 000 ms — allow some tolerance.
    expect(result).toBeGreaterThan(28_000);
    expect(result).toBeLessThanOrEqual(31_000);
  });

  // -----------------------------------------------------------------------
  // 7. Queue overflow: throws when queue exceeds MAX_QUEUE_SIZE (1 000)
  // -----------------------------------------------------------------------
  it('throws on queue overflow when too many acquires are pending', async () => {
    // Very small capacity + near-zero refill so every acquire blocks.
    const limiter = new RateLimiter(1, 0.000_000_1);

    // Drain the only token so every subsequent acquire must queue.
    await limiter.acquire();

    // The first acquire after the drain enters `acquireInternal` and sleeps,
    // setting `processing = true`. Subsequent calls go into the FIFO queue.
    // We push 1 001 concurrent acquires — the 1 001st should overflow.
    const promises: Promise<void>[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < 1_002; i++) {
      promises.push(limiter.acquire().catch((err: Error) => { errors.push(err); }));
    }

    // Give the micro-task queue a chance to schedule them all.
    await vi.waitFor(() => {
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    expect(errors[0]!.message).toMatch(/queue overflow/i);
  });

  // -----------------------------------------------------------------------
  // 8. FIFO ordering: two concurrent acquires resolve in order
  // -----------------------------------------------------------------------
  it('resolves concurrent acquires in FIFO order', async () => {
    // Capacity 1 so the second acquire must wait for the first to complete.
    const limiter = new RateLimiter(1, 10); // high refill so it finishes fast

    const order: number[] = [];

    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));

    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });
});
