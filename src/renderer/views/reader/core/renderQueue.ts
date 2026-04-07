export type RenderFn = () => Promise<void>;

export interface RenderRequest {
  pageNumber: number;
  renderFn: RenderFn;
  cancelled: boolean;
}

const MAX_CONCURRENT = 2;
const MAX_QUEUE_SIZE = 64;

export class RenderQueue {
  private queue: RenderRequest[] = [];
  private activeCount = 0;
  private currentPage = 1;

  enqueue(
    pageNumber: number,
    renderFn: RenderFn,
    currentPage: number,
  ): RenderRequest {
    this.currentPage = currentPage;

    const request: RenderRequest = {
      pageNumber,
      renderFn,
      cancelled: false,
    };

    // Enforce queue size limit — drop the farthest-from-current-page entry
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      let worstIdx = 0;
      let worstDist = 0;
      for (let i = 0; i < this.queue.length; i++) {
        const dist = Math.abs(this.queue[i]!.pageNumber - currentPage);
        if (dist > worstDist) {
          worstDist = dist;
          worstIdx = i;
        }
      }
      this.queue[worstIdx]!.cancelled = true;
      this.queue.splice(worstIdx, 1);
    }

    const priority = Math.abs(pageNumber - currentPage);

    // Insert sorted by priority (lowest first = closest to current page).
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      const existingPriority = Math.abs(
        this.queue[i]!.pageNumber - currentPage,
      );
      if (priority < existingPriority) {
        this.queue.splice(i, 0, request);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(request);
    }

    this.processNext();
    return request;
  }

  cancelOutsideWindow(windowPages: Set<number>): void {
    for (const request of this.queue) {
      if (!windowPages.has(request.pageNumber)) {
        request.cancelled = true;
      }
    }
    // Compact cancelled entries
    this.queue = this.queue.filter((r) => !r.cancelled);
  }

  cancelAll(): void {
    for (const request of this.queue) {
      request.cancelled = true;
    }
    this.queue = [];
  }

  private processNext(): void {
    if (this.activeCount >= MAX_CONCURRENT) {
      return;
    }

    // Re-sort queue by dynamic priority (current page may have changed)
    const cp = this.currentPage;
    this.queue.sort(
      (a, b) => Math.abs(a.pageNumber - cp) - Math.abs(b.pageNumber - cp),
    );

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      if (request.cancelled) {
        continue;
      }

      this.activeCount++;
      request
        .renderFn()
        .catch((err: unknown) => {
          console.warn('[RenderQueue] Page render failed:', err);
        })
        .finally(() => {
          this.activeCount--;
          this.processNext();
        });
      return;
    }
  }
}
