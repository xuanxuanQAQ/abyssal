/**
 * LayoutContext — 导航栏位置、默认面板宽度、动画开关
 *
 * 持久化到 localStorage，低频变更。
 *
 * v1.1: 设置 data-reduce-motion 属性并监听 prefers-reduced-motion。
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';

type NavRailPosition = 'left' | 'top';

interface LayoutContextValue {
  navRailPosition: NavRailPosition;
  defaultContextPanelWidth: number;
  animationEnabled: boolean;
  setNavRailPosition: (pos: NavRailPosition) => void;
  setDefaultContextPanelWidth: (width: number) => void;
  setAnimationEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'abyssal-layout';

interface StoredLayout {
  navRailPosition: NavRailPosition;
  defaultContextPanelWidth: number;
  animationEnabled: boolean;
}

function loadLayout(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredLayout;
  } catch {
    // ignore
  }
  return {
    navRailPosition: 'left',
    defaultContextPanelWidth: 380,
    animationEnabled: true,
  };
}

function saveLayout(layout: StoredLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<StoredLayout>(loadLayout);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  // §10.3 data-reduce-motion 属性同步
  useEffect(() => {
    if (layout.animationEnabled) {
      delete document.documentElement.dataset['reduceMotion'];
    } else {
      document.documentElement.dataset['reduceMotion'] = '';
    }
  }, [layout.animationEnabled]);

  // §10.3 监听系统 prefers-reduced-motion 媒体查询
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setLayout((l) => ({ ...l, animationEnabled: false }));
      }
    };
    // 初始检测
    if (mql.matches) {
      setLayout((l) => ({ ...l, animationEnabled: false }));
    }
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setNavRailPosition = useCallback(
    (pos: NavRailPosition) =>
      setLayout((l) => ({ ...l, navRailPosition: pos })),
    []
  );

  const setDefaultContextPanelWidth = useCallback(
    (width: number) =>
      setLayout((l) => ({ ...l, defaultContextPanelWidth: width })),
    []
  );

  const setAnimationEnabled = useCallback(
    (enabled: boolean) =>
      setLayout((l) => ({ ...l, animationEnabled: enabled })),
    []
  );

  return (
    <LayoutContext.Provider
      value={{
        ...layout,
        setNavRailPosition,
        setDefaultContextPanelWidth,
        setAnimationEnabled,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
