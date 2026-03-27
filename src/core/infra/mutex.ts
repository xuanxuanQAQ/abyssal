// ═══ Mutex ═══
//
// 互斥锁 — 保护 SQLite 写操作的串行化。
// 基于 Promise 和内部等待队列（FIFO）。
//
// ┌─────────────────────────────────────────────────────────────┐
// │ 死锁防护军规：互斥原语的获取顺序必须保持单向               │
// │                                                             │
// │ 合法顺序：Semaphore → Mutex（先获取外层并发控制，再获取写锁）│
// │ 禁止反向：Mutex → Semaphore（会导致经典的交叉等待死锁）     │
// │                                                             │
// │ 即：持有 Mutex 时绝对禁止等待 Semaphore 许可；               │
// │     持有 Semaphore 许可时可以安全地等待 Mutex。               │
// └─────────────────────────────────────────────────────────────┘

export class Mutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  /**
   * 获取锁。如果锁未被持有，立即返回 release 函数；
   * 否则挂起调用者，等待锁释放后按 FIFO 唤醒。
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
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
      if (released) return; // 防止 double-release
      released = true;

      const next = this.queue.shift();
      if (next) {
        // 直接交接给下一个等待者，locked 保持 true
        next();
      } else {
        this.locked = false;
      }
    };
  }

  /** 当前是否被锁定 */
  get isLocked(): boolean {
    return this.locked;
  }

  /** 等待队列长度 */
  get waitingCount(): number {
    return this.queue.length;
  }
}
