export interface RenderWindowConfig {
  fullRenderRange: number;
  cacheRange: number;
}

export const DEFAULT_RENDER_WINDOW: RenderWindowConfig = {
  fullRenderRange: 2,
  cacheRange: 4,
};

export interface RenderWindowResult {
  fullRender: Set<number>;
  cached: Set<number>;
  placeholder: Set<number>;
}

export function computeRenderWindow(
  currentPage: number,
  totalPages: number,
  config: RenderWindowConfig = DEFAULT_RENDER_WINDOW,
): RenderWindowResult {
  const fullRender = new Set<number>();
  const cached = new Set<number>();
  const placeholder = new Set<number>();

  const fullLo = Math.max(1, currentPage - config.fullRenderRange);
  const fullHi = Math.min(totalPages, currentPage + config.fullRenderRange);

  const cacheLo = Math.max(1, currentPage - config.cacheRange);
  const cacheHi = Math.min(totalPages, currentPage + config.cacheRange);

  for (let p = 1; p <= totalPages; p++) {
    if (p >= fullLo && p <= fullHi) {
      fullRender.add(p);
    } else if (p >= cacheLo && p <= cacheHi) {
      cached.add(p);
    } else {
      placeholder.add(p);
    }
  }

  return { fullRender, cached, placeholder };
}

export function computeWindowDiff(
  oldWindow: RenderWindowResult,
  newWindow: RenderWindowResult,
): { enter: number[]; exit: number[] } {
  const enter: number[] = [];
  const exit: number[] = [];

  const oldAll = new Set([
    ...oldWindow.fullRender,
    ...oldWindow.cached,
  ]);
  const newAll = new Set([
    ...newWindow.fullRender,
    ...newWindow.cached,
  ]);

  for (const page of newAll) {
    if (!oldAll.has(page)) {
      enter.push(page);
    }
  }

  for (const page of oldAll) {
    if (!newAll.has(page)) {
      exit.push(page);
    }
  }

  return { enter, exit };
}
