/**
 * ThemeContext — 颜色方案、强调色、字号
 *
 * 主存储为 config 系统（appearance section），通过 IPC 读写。
 * localStorage 仅作为启动闪屏防护（避免白屏闪烁），以 IPC 值为准。
 * 监听 push:settingsChanged 以响应外部变更（如 AI 修改主题）。
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

type ColorScheme = 'light' | 'dark' | 'system';
type FontSize = 'sm' | 'base' | 'lg';

interface ThemeContextValue {
  colorScheme: ColorScheme;
  accentColor: string;
  fontSize: FontSize;
  resolvedScheme: 'light' | 'dark';
  setColorScheme: (scheme: ColorScheme) => void;
  setAccentColor: (color: string) => void;
  setFontSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'abyssal-theme';

interface StoredTheme {
  colorScheme: ColorScheme;
  accentColor: string;
  fontSize: FontSize;
}

const DEFAULT_THEME: StoredTheme = { colorScheme: 'system', accentColor: '#3B82F6', fontSize: 'base' };

/** 快速加载 localStorage 防止启动白屏闪烁 */
function loadThemeFromStorage(): StoredTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredTheme;
  } catch {
    // ignore
  }
  return DEFAULT_THEME;
}

function saveThemeToStorage(theme: StoredTheme): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
}

function getSystemScheme(): 'light' | 'dark' {
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 初始值从 localStorage 快速加载（防闪烁），后续由 IPC 覆盖
  const [theme, setTheme] = useState<StoredTheme>(loadThemeFromStorage);

  const resolvedScheme =
    theme.colorScheme === 'system' ? getSystemScheme() : theme.colorScheme;

  // 启动后从 config 系统加载真实值
  useEffect(() => {
    getAPI().settings.getAll().then((data) => {
      if (data?.appearance) {
        const remote: StoredTheme = {
          colorScheme: data.appearance.colorScheme ?? DEFAULT_THEME.colorScheme,
          accentColor: data.appearance.accentColor ?? DEFAULT_THEME.accentColor,
          fontSize: data.appearance.fontSize ?? DEFAULT_THEME.fontSize,
        };
        setTheme(remote);
        saveThemeToStorage(remote);
      }
    }).catch(() => { /* stub mode — keep localStorage value */ });
  }, []);

  // 监听 push:settingsChanged（AI 或其他来源修改了 appearance）
  useEffect(() => {
    const api = getAPI();
    const unsub = api.on.settingsChanged((event: { section: string; keys: string[] }) => {
      if (event.section !== 'appearance') return;
      api.settings.getAll().then((data) => {
        if (data?.appearance) {
          const remote: StoredTheme = {
            colorScheme: data.appearance.colorScheme ?? DEFAULT_THEME.colorScheme,
            accentColor: data.appearance.accentColor ?? DEFAULT_THEME.accentColor,
            fontSize: data.appearance.fontSize ?? DEFAULT_THEME.fontSize,
          };
          setTheme(remote);
          saveThemeToStorage(remote);
        }
      }).catch(() => {});
    });
    return unsub;
  }, []);

  // 监听系统主题变化
  useEffect(() => {
    if (theme.colorScheme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setTheme((t) => ({ ...t })); // 触发重渲染
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme.colorScheme]);

  // localStorage 缓存（下次启动防闪烁）
  useEffect(() => {
    saveThemeToStorage(theme);
  }, [theme]);

  // 应用到 document
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolvedScheme;
    document.documentElement.style.setProperty(
      '--accent-color',
      theme.accentColor
    );
    document.documentElement.dataset['fontSize'] = theme.fontSize;
  }, [resolvedScheme, theme.accentColor, theme.fontSize]);

  /** 写入 config 系统并更新本地状态 */
  const persistToConfig = useCallback((patch: Partial<StoredTheme>) => {
    getAPI().settings.updateSection('appearance', patch).catch(() => {});
  }, []);

  const setColorScheme = useCallback(
    (scheme: ColorScheme) => {
      setTheme((t) => ({ ...t, colorScheme: scheme }));
      persistToConfig({ colorScheme: scheme });
    },
    [persistToConfig]
  );

  const setAccentColor = useCallback(
    (color: string) => {
      setTheme((t) => ({ ...t, accentColor: color }));
      persistToConfig({ accentColor: color });
    },
    [persistToConfig]
  );

  const setFontSize = useCallback(
    (size: FontSize) => {
      setTheme((t) => ({ ...t, fontSize: size }));
      persistToConfig({ fontSize: size });
    },
    [persistToConfig]
  );

  return (
    <ThemeContext.Provider
      value={{
        ...theme,
        resolvedScheme,
        setColorScheme,
        setAccentColor,
        setFontSize,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
