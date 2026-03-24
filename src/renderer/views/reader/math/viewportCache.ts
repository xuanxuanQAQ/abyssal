/**
 * LRU cache for PDF viewport objects.
 *
 * Avoids redundant `page.getViewport()` calls by caching viewport data
 * keyed on `pageNumber:scale`. Evicts oldest entries (by insertion order
 * via Map) when the cache exceeds 100 entries.
 */

import { type Transform6 } from "./coordinateTransform";
import { computeInverseTransform } from "./inverseTransform";

export interface ViewportCacheEntry {
  viewport: {
    width: number;
    height: number;
    transform: Transform6;
    scale: number;
    rotation: number;
  };
  /** 预计算的逆变换矩阵（避免每帧重算） */
  inverseTransform?: Transform6;
}

const MAX_ENTRIES = 100;

function makeKey(pageNumber: number, scale: number): string {
  return `${pageNumber}:${scale}`;
}

export class ViewportCache {
  private readonly cache = new Map<string, ViewportCacheEntry>();

  /**
   * Retrieve a cached viewport entry, or `undefined` if not cached.
   */
  get(
    pageNumber: number,
    scale: number,
  ): ViewportCacheEntry | undefined {
    return this.cache.get(makeKey(pageNumber, scale));
  }

  /**
   * Store a viewport entry in the cache. If the cache exceeds the maximum
   * size, the oldest entry (by insertion order) is evicted.
   */
  set(
    pageNumber: number,
    scale: number,
    viewport: ViewportCacheEntry["viewport"],
  ): void {
    const key = makeKey(pageNumber, scale);

    // Delete first so re-insertion moves the key to the end of the Map
    // (most recently used position).
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, { viewport });

    // Evict oldest entries if over capacity.
    if (this.cache.size > MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Invalidate cached entries.
   *
   * @param pageNumber - If provided, only entries for that page are removed.
   *                     If omitted, the entire cache is cleared.
   */
  /**
   * Get the inverse transform for a cached viewport, computing and caching it on first access.
   */
  getInverseTransform(pageNumber: number, scale: number): Transform6 | undefined {
    const entry = this.get(pageNumber, scale);
    if (!entry) return undefined;
    if (!entry.inverseTransform) {
      entry.inverseTransform = computeInverseTransform(entry.viewport.transform);
    }
    return entry.inverseTransform;
  }

  invalidate(pageNumber?: number): void {
    if (pageNumber === undefined) {
      this.cache.clear();
      return;
    }

    const prefix = `${pageNumber}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}
