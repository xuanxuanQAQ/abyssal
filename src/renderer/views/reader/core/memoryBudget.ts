export const MAX_TOTAL_PIXELS = 256_000_000;
export const HIGH_SCALE_THRESHOLD = 2.0;

export class MemoryBudget {
  private canvasPixels: Map<number, number> = new Map();

  registerCanvas(pageNumber: number, width: number, height: number): void {
    this.canvasPixels.set(pageNumber, width * height);
  }

  unregisterCanvas(pageNumber: number): void {
    this.canvasPixels.delete(pageNumber);
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
  }
}
