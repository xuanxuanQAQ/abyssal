// ═══ Mutex ═══
//
// 互斥锁 — 保护 SQLite 写操作的串行化。
// 基于 Promise 和内部等待队列（FIFO）。

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
