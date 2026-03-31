/**
 * react-i18next 类型扩展
 *
 * 将 en.ts 的字典形状注入到 t() 函数的类型系统中，
 * 实现编译期键值检查与 IDE 自动补全。
 */

import 'react-i18next';
import type { TranslationSchema } from './locales/en';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: TranslationSchema;
    };
  }
}
