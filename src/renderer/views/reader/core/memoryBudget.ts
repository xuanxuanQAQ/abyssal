export const MAX_TOTAL_PIXELS = 256_000_000;
export const HIGH_SCALE_THRESHOLD = 2.0;

/**
 * §5.4: Enhanced memory budget with LRU page tracking.
 *
 * Tracks canvas pixel usage per page plus access recency.
 * getEvictionCandidates() returns pages sorted oldest-access-first
 * so the caller can release distant pages before the budget overflows.
 */
export class MemoryBudget {
  private canvasPixels: Map<number, number> = new Map();
  /** Monotonic counter for LRU eviction (avoids Date.now() millisecond collisions). */
  private accessOrder: Map<number, number> = new Map();
  private accessCounter = 0;

  registerCanvas(pageNumber: number, width: number, height: number): void {
    this.canvasPixels.set(pageNumber, width * height);
    this.accessOrder.set(pageNumber, ++this.accessCounter);
  }

  unregisterCanvas(pageNumber: number): void {
    this.canvasPixels.delete(pageNumber);
    this.accessOrder.delete(pageNumber);
  }

  /** Mark a page as recently accessed (call on scroll into view). */
  touch(pageNumber: number): void {
    if (this.canvasPixels.has(pageNumber)) {
      this.accessOrder.set(pageNumber, ++this.accessCounter);
    }
  }

  getTotalPixels(): number {
    let total = 0;
    for (const pixels of this.canvasPixels.values()) {
      total += pixels;
    }
    return total;
  }

  isOverBudget(): boolean {
    return this.getTotalPixels() > MAX_TOTAL_PIXELS;
  }

  /**
   * Returns page numbers sorted by least-recently-accessed first.
   * Caller can iterate and evict until budget is satisfied.
   */
  getEvictionCandidates(): number[] {
    return Array.from(this.accessOrder.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([pageNumber]) => pageNumber);
  }

  /** Number of canvases currently tracked. */
  get activeCanvasCount(): number {
    return this.canvasPixels.size;
  }

  getRecommendedCacheRange(currentScale: number): number {
    if (currentScale > HIGH_SCALE_THRESHOLD) {
      return 1;
    }
    if (this.isOverBudget()) {
      return 2;
    }
    return 4;
  }

  clear(): void {
    this.canvasPixels.clear();
    this.accessOrder.clear();
  }
}
