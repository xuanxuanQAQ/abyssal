/**
 * ThemeContext — 颜色方案、强调色、字号
 *
 * 持久化到 localStorage，低频变更。
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';

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

function loadTheme(): StoredTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredTheme;
  } catch {
    // ignore
  }
  return { colorScheme: 'system', accentColor: '#3B82F6', fontSize: 'base' };
}

function saveTheme(theme: StoredTheme): void {
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
  const [theme, setTheme] = useState<StoredTheme>(loadTheme);

  const resolvedScheme =
    theme.colorScheme === 'system' ? getSystemScheme() : theme.colorScheme;

  // 监听系统主题变化
  useEffect(() => {
    if (theme.colorScheme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setTheme((t) => ({ ...t })); // 触发重渲染
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme.colorScheme]);

  // 持久化
  useEffect(() => {
    saveTheme(theme);
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

  const setColorScheme = useCallback(
    (scheme: ColorScheme) => setTheme((t) => ({ ...t, colorScheme: scheme })),
    []
  );

  const setAccentColor = useCallback(
    (color: string) => setTheme((t) => ({ ...t, accentColor: color })),
    []
  );

  const setFontSize = useCallback(
    (size: FontSize) => setTheme((t) => ({ ...t, fontSize: size })),
    []
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
