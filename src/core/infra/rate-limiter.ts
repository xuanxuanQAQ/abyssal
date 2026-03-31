// ═══ RateLimiter ═══
//
// 令牌桶（Token Bucket）算法 + FIFO 公平队列 + 429 冻结机制。

/** 429 退避默认值（毫秒） */
export const DEFAULT_BACKOFF_MS: Record<string, number> = {
  semanticScholar: 60_000,
  openAlex: 5_000,
  arxiv: 10_000,
  crossRef: 5_000,
  unpaywall: 5_000,
};

export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens/ms

  /** 429 冻结截止时间戳。Date.now() < frozenUntil 时所有 acquire 阻塞 */
  private frozenUntil: number = 0;

  /** FIFO 等待队列——保证并发 acquire 按入队顺序获取令牌 */
  private readonly queue: Array<() => void> = [];
  private processing: boolean = false;
  /** Fix: 队列最大长度——防止无限堆积 */
  private static readonly MAX_QUEUE_SIZE = 1000;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * 异步获取一个令牌（FIFO 顺序）。
   * 如果令牌桶被冻结（429 退避），等待冻结结束后再获取。
   */
  async acquire(): Promise<void> {
    // 排队——如果已有等待者，追加到队列末尾
    if (this.processing) {
      if (this.queue.length >= RateLimiter.MAX_QUEUE_SIZE) {
        throw new Error(`Rate limiter queue overflow (max ${RateLimiter.MAX_QUEUE_SIZE})`);
      }
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.processing = true;
    try {
      await this.acquireInternal();
    } finally {
      // 唤醒下一个等待者
      this.processing = false;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private async acquireInternal(): Promise<void> {
    // 冻结等待
    const now = Date.now();
    if (now < this.frozenUntil) {
      await this.sleep(this.frozenUntil - now);
    }

    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = (1 - this.tokens) / this.refillRate;
    await this.sleep(waitMs);
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  /** 同步尝试获取。成功返回 true，失败返回 false（不等待） */
  tryAcquire(): boolean {
    if (Date.now() < this.frozenUntil) return false;

    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * 冻结令牌桶（收到 429 后调用）。
   * 将 tokens 清零，在 durationMs 内阻塞所有后续 acquire。
   */
  freeze(durationMs: number): void {
    this.tokens = 0;
    this.frozenUntil = Date.now() + durationMs;
  }

  /** 解析 Retry-After 头 → 冻结毫秒数 */
  static parseRetryAfter(
    header: string | undefined | null,
    defaultMs: number,
  ): number {
    if (!header) return defaultMs;

    // 纯数字（秒）
    const seconds = Number(header);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }

    // HTTP-date
    try {
      const date = new Date(header);
      if (!Number.isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    } catch {
      // 解析失败，使用默认值
    }

    return defaultMs;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate,
    );
    this.lastRefillTime = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.ceil(ms)));
  }
}

// ═══ 预配置工厂 ═══

export const API_RATE_LIMITS = {
  semanticScholarWithKey: { capacity: 10, refillRate: 1 / 1000 },
  semanticScholarNoKey: { capacity: 100, refillRate: 100 / 300_000 },
  openAlex: { capacity: 10, refillRate: 10 / 1000 },
  arxiv: { capacity: 1, refillRate: 1 / 3000 },
  crossRef: { capacity: 50, refillRate: 50 / 1000 },
  unpaywall: { capacity: 10, refillRate: 10 / 1000 },
  webSearch: { capacity: 5, refillRate: 1 / 1000 },
} as const;

export function createRateLimiter(
  api: keyof typeof API_RATE_LIMITS,
): RateLimiter {
  const cfg = API_RATE_LIMITS[api];
  return new RateLimiter(cfg.capacity, cfg.refillRate);
}
