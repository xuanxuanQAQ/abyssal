/**
 * i18n 初始化 — 渲染进程入口
 *
 * 使用 i18next + react-i18next，翻译字典为 TypeScript 对象（非 JSON），
 * 通过 react-i18next.d.ts 实现 t() 函数的完整类型推导与自动补全。
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '中文' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: localStorage.getItem('abyssal-ui-locale') ?? 'en',
  fallbackLng: 'en',
  // 不要把 'zh-CN' 拆成 ['zh-CN', 'zh'] 去逐级查找，直接精确匹配 resources 键
  load: 'currentOnly',
  interpolation: { escapeValue: false },
  react: {
    // 关闭 Suspense 模式 — 语言切换时直接触发重渲染，无需 Suspense 边界
    useSuspense: false,
  },
});

/** Change locale and persist to localStorage */
export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
  localStorage.setItem('abyssal-ui-locale', locale);
}

export default i18n;
