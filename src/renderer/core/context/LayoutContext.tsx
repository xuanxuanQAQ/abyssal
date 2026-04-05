/**
 * LayoutContext — UI 动画偏好
 *
 * 主存储为 config 系统（appearance.animationEnabled），通过 IPC 读写。
 * localStorage 仅作为启动快速加载缓存。
 *
 * v1.1: 设置 data-reduce-motion 属性并监听 prefers-reduced-motion。
 * v1.2: 迁移到 config 系统，监听 push:settingsChanged。
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { getAPI } from '../ipc/bridge';

interface LayoutContextValue {
  animationEnabled: boolean;
  setAnimationEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'abyssal-layout';

interface StoredLayout {
  animationEnabled: boolean;
}

function loadLayoutFromStorage(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredLayout;
  } catch {
    // ignore
  }
  return { animationEnabled: true };
}

function saveLayoutToStorage(layout: StoredLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState<StoredLayout>(loadLayoutFromStorage);

  // 启动后从 config 系统加载真实值
  useEffect(() => {
    getAPI().settings.getAll().then((data) => {
      if (data?.appearance) {
        const enabled = data.appearance.animationEnabled ?? true;
        setLayout({ animationEnabled: enabled });
        saveLayoutToStorage({ animationEnabled: enabled });
      }
    }).catch(() => {});
  }, []);

  // 监听 push:settingsChanged（AI 或其他来源修改了 appearance）
  useEffect(() => {
    const api = getAPI();
    const unsub = api.on.settingsChanged((event: { section: string; keys: string[] }) => {
      if (event.section !== 'appearance') return;
      api.settings.getAll().then((data) => {
        if (data?.appearance) {
          const enabled = data.appearance.animationEnabled ?? true;
          setLayout({ animationEnabled: enabled });
          saveLayoutToStorage({ animationEnabled: enabled });
        }
      }).catch(() => {});
    });
    return unsub;
  }, []);

  // localStorage 缓存
  useEffect(() => {
    saveLayoutToStorage(layout);
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
        getAPI().settings.updateSection('appearance', { animationEnabled: false }).catch(() => {});
      }
    };
    // 初始检测
    if (mql.matches) {
      setLayout((l) => ({ ...l, animationEnabled: false }));
      getAPI().settings.updateSection('appearance', { animationEnabled: false }).catch(() => {});
    }
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setAnimationEnabled = useCallback(
    (enabled: boolean) => {
      setLayout((l) => ({ ...l, animationEnabled: enabled }));
      getAPI().settings.updateSection('appearance', { animationEnabled: enabled }).catch(() => {});
    },
    []
  );

  return (
    <LayoutContext.Provider
      value={{
        ...layout,
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
