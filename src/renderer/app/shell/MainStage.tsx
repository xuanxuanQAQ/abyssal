/**
 * MainStage — Keep-Alive 视图切换容器（§5）
 *
 * 策略：已访问过的视图保持挂载（display:none），
 * 保留 DOM/Canvas/WebGL/编辑器实例，切换零开销。
 *
 * - 首次访问：React.lazy 按需加载代码 + Suspense fallback
 * - 再次访问：display 切换，瞬间恢复
 * - 内存管理：最多保留 4 个 keep-alive 视图，LRU 淘汰最久未访问的
 */

import React, { Suspense, useDeferredValue, useRef } from 'react';
import { useAppStore } from '../../core/store';
import { ViewErrorBoundary } from '../ErrorBoundaries';
import { LibraryView } from '../../views/library/LibraryView';
import { ViewActiveContext } from '../../core/context/ViewActiveContext';
import type { ViewType } from '../../../shared-types/enums';

// ═══ 可预加载的 lazy 组件 ═══

function createPreloadableLazy<T extends React.ComponentType>(
  factory: () => Promise<{ default: T }>,
) {
  let preloaded: Promise<{ default: T }> | null = null;
  const LazyComponent = React.lazy(() => preloaded ?? factory());

  return Object.assign(LazyComponent, {
    preload() {
      if (!preloaded) preloaded = factory();
      return preloaded;
    },
  });
}

const ReaderView = createPreloadableLazy(() =>
  import('../../views/reader/ReaderView').then((m) => ({ default: m.ReaderView as React.ComponentType })),
);
const GraphView = createPreloadableLazy(() =>
  import('../../views/graph/GraphView').then((m) => ({ default: m.GraphView as React.ComponentType })),
);
const WritingView = createPreloadableLazy(() =>
  import('../../views/writing/WritingView').then((m) => ({ default: m.WritingView as React.ComponentType })),
);
const AnalysisView = createPreloadableLazy(() =>
  import('../../views/analysis/AnalysisView').then((m) => ({ default: m.AnalysisView as React.ComponentType })),
);
const NotesView = createPreloadableLazy(() =>
  import('../../views/notes/NotesView').then((m) => ({ default: m.NotesView as React.ComponentType })),
);

const SettingsView = createPreloadableLazy(() =>
  import('../../views/settings/SettingsView').then((m) => ({ default: m.SettingsView as React.ComponentType })),
);

// ═══ 视图配置 ═══

interface ViewConfig {
  component: React.ComponentType;
  keepAlive: boolean;
  preload?: (() => void) | undefined;
}

const VIEW_CONFIG: Record<ViewType, ViewConfig> = {
  library:  { component: LibraryView, keepAlive: true },
  reader:   { component: ReaderView, keepAlive: true, preload: ReaderView.preload },
  analysis: { component: AnalysisView, keepAlive: true, preload: AnalysisView.preload },
  graph:    { component: GraphView, keepAlive: false, preload: GraphView.preload }, // WebGL 上下文不兼容 display:none
  writing:  { component: WritingView, keepAlive: true, preload: WritingView.preload },
  notes:    { component: NotesView, keepAlive: true, preload: NotesView.preload },
  settings: { component: SettingsView, keepAlive: false, preload: SettingsView.preload },
};

/** 最大 keep-alive 视图数量（含当前活动视图） */
const MAX_ALIVE = 4;

// ═══ 预加载 API（供 NavRail 使用） ═══

export function preloadView(viewType: ViewType): void {
  VIEW_CONFIG[viewType]?.preload?.();
}

/**
 * 预加载全部 lazy 视图的 JS chunk。
 * Electron 从本地磁盘加载，lazy split 的网络收益不存在，
 * 提前加载可消除首次切换时的 Suspense fallback 闪烁。
 */
export function preloadAllViews(): void {
  const entries = Object.entries(VIEW_CONFIG) as [ViewType, ViewConfig][];
  for (const [, config] of entries) {
    config.preload?.();
  }
}

// 模块级立即预加载 — 不等 idle callback，Electron 本地磁盘 IO 几乎无开销
queueMicrotask(preloadAllViews);

// ═══ Suspense fallback ═══

function ViewLoading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
      加载中…
    </div>
  );
}

// ═══ MainStage ═══

export function MainStage() {
  const activeView = useAppStore((s) => s.activeView);

  // ── Deferred view：首次访问 lazy 视图时保持旧视图可见，不闪 fallback ──
  // activeView 立即更新（NavRail 高亮响应），renderView 延迟到 chunk 就绪后才切换。
  const renderView = useDeferredValue(activeView);

  // ── 同步 LRU 派生（消除 useEffect 导致的一帧空白） ──
  // 基于 renderView 计算，确保新视图的 DOM 只在 chunk 就绪后才插入。
  const aliveRef = useRef<ViewType[]>(['library']);
  const prevRenderRef = useRef<ViewType>(renderView);

  if (prevRenderRef.current !== renderView) {
    const leaving = prevRenderRef.current;
    prevRenderRef.current = renderView;

    const prev = aliveRef.current;

    // 移除离开的非 keep-alive 视图
    let cleaned = prev;
    if (leaving !== renderView) {
      const leavingConfig = VIEW_CONFIG[leaving];
      if (!leavingConfig.keepAlive) {
        cleaned = prev.filter((v) => v !== leaving);
      }
    }

    // 将当前视图移到末尾（最近访问）
    const without = cleaned.filter((v) => v !== renderView);
    const updated = [...without, renderView];

    // LRU 淘汰
    while (updated.length > MAX_ALIVE) {
      const oldest = updated[0]!;
      if (oldest === renderView) break;
      updated.shift();
    }

    aliveRef.current = updated;
  }

  const aliveViews = aliveRef.current;

  return (
    <main
      role="tabpanel"
      aria-labelledby={`nav-${activeView}`}
      style={{ flex: 1, height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      {aliveViews.map((viewType) => {
        const config = VIEW_CONFIG[viewType];
        const isActive = viewType === renderView;
        const ViewComponent = config.component;

        // 非 keep-alive 视图：仅在活动时渲染
        if (!config.keepAlive && !isActive) return null;

        return (
          <div
            key={viewType}
            style={{
              position: 'absolute',
              inset: 0,
              display: isActive ? 'block' : 'none',
              pointerEvents: isActive ? 'auto' : 'none',
            }}
            {...(!isActive ? { inert: true } : {})}
          >
            <ViewActiveContext.Provider value={isActive}>
              <ViewErrorBoundary viewKey={viewType}>
                <Suspense fallback={<ViewLoading />}>
                  <ViewComponent />
                </Suspense>
              </ViewErrorBoundary>
            </ViewActiveContext.Provider>
          </div>
        );
      })}
    </main>
  );
}
