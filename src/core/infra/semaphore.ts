// ═══ Semaphore ═══
//
// 信号量 — 控制并发数（如 acquire 模块 5 并发下载、analyze 3 并发 LLM 调用）。
// 基于 Promise 和内部等待队列。
//
// 死锁防护：见 mutex.ts 中的获取顺序军规。
// Semaphore 是外层并发控制，Mutex 是内层写锁。
// 合法顺序：Semaphore.acquire → Mutex.acquire → Mutex.release → Semaphore.release

export class Semaphore {
  private current = 0;
  private readonly max: number;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error(
        `Semaphore maxConcurrency must be >= 1, got ${maxConcurrency}`,
      );
    }
    this.max = maxConcurrency;
  }

  /**
   * 获取一个并发槽位。如果当前并发数 < maxConcurrency，立即返回 release 函数；
   * 否则挂起等待。
   */
  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(this.createRelease());
      });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const next = this.queue.shift();
      if (next) {
        // 直接交接，current 不变
        next();
      } else {
        this.current--;
      }
    };
  }

  /** 当前正在执行的并发数 */
  get currentCount(): number {
    return this.current;
  }

  /** 等待队列中的任务数 */
  get waitingCount(): number {
    return this.queue.length;
  }
}
