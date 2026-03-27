/**
 * Concurrency Guard — three-zone separation utility for workflow processing.
 *
 * Wraps Semaphore + Mutex to enforce the correct acquisition order
 * (Semaphore → Mutex) and the three-zone pattern:
 *
 *   Zone 1 (Read):  No lock needed — WAL snapshot reads
 *   Zone 2 (LLM):   No lock needed — async network I/O
 *   Zone 3 (Write):  Mutex-protected — serialized DB writes
 *
 * See spec: §4.4 (concurrency config), §4.5 (three-zone separation)
 */

import { Semaphore } from '../../core/infra/semaphore';
import { Mutex } from '../../core/infra/mutex';

// ─── Default concurrency per workflow (§4.4) ───

export const DEFAULT_CONCURRENCY: Record<string, number> = {
  discover:     1,
  acquire:      5,
  analyze:      3,
  synthesize:   1,
  article:      1,
  bibliography: 10,
};

// ─── Concurrency Guard ───

export class ConcurrencyGuard {
  private readonly semaphore: Semaphore;
  private readonly writeMutex: Mutex;

  constructor(concurrency: number) {
    this.semaphore = new Semaphore(concurrency);
    this.writeMutex = new Mutex();
  }

  /**
   * Run a batch processing function with Semaphore concurrency control.
   * The fn receives a `writeExclusive` helper for Zone 3 operations.
   */
  async runWithSlot<T>(
    fn: (guard: { writeExclusive: <R>(writeFn: () => R | Promise<R>) => Promise<R> }) => Promise<T>,
  ): Promise<T> {
    const releaseSemaphore = await this.semaphore.acquire();
    try {
      return await fn({
        writeExclusive: async <R>(writeFn: () => R | Promise<R>): Promise<R> => {
          const releaseMutex = await this.writeMutex.acquire();
          try {
            return await writeFn();
          } finally {
            releaseMutex();
          }
        },
      });
    } finally {
      releaseSemaphore();
    }
  }

  /**
   * Execute a write-only operation under Mutex protection (no Semaphore).
   * Use for lightweight writes that don't consume a concurrency slot.
   */
  async writeExclusive<R>(fn: () => R | Promise<R>): Promise<R> {
    const release = await this.writeMutex.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get pendingSlots(): number {
    return this.semaphore.waitingCount;
  }

  get pendingWrites(): number {
    return this.writeMutex.waitingCount;
  }
}

/**
 * Create a ConcurrencyGuard with the default concurrency for the given workflow,
 * optionally overridden by user config.
 */
export function createConcurrencyGuard(
  workflowType: string,
  userConcurrency?: number,
): ConcurrencyGuard {
  const concurrency = userConcurrency ?? DEFAULT_CONCURRENCY[workflowType] ?? 1;
  return new ConcurrencyGuard(concurrency);
}
