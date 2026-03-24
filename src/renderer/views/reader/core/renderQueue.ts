export type RenderFn = () => Promise<void>;

export interface RenderRequest {
  pageNumber: number;
  renderFn: RenderFn;
  cancelled: boolean;
}

const MAX_CONCURRENT = 2;

export class RenderQueue {
  private queue: RenderRequest[] = [];
  private activeCount = 0;

  enqueue(
    pageNumber: number,
    renderFn: RenderFn,
    currentPage: number,
  ): RenderRequest {
    const request: RenderRequest = {
      pageNumber,
      renderFn,
      cancelled: false,
    };

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
