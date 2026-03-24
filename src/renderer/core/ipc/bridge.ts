/**
 * IPC 桥接层类型声明 & 访问辅助
 *
 * window.abyssal 的类型声明，由 preload.ts 通过 contextBridge 注入。
 * 渲染进程通过此模块安全访问 IPC API。
 */

import type { AbyssalAPI } from '../../../shared-types/ipc';

/**
 * 扩展全局 Window 接口
 */
declare global {
  interface Window {
    abyssal: AbyssalAPI;
  }
}

/**
 * 当 preload 不可用时（如 Vite dev server 直接加载），
 * 返回一个 Proxy stub，所有 IPC 调用变为 no-op 并打印警告。
 * 这样 UI 可以正常渲染，只是 IPC 功能不可用。
 */
function createStubAPI(): AbyssalAPI {
  // 递归 Proxy：支持任意层级属性访问（api.app.window.onMaximizedChange 等）
  function makeDeepProxy(path: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        const newPath = [...path, prop];
        // onXxx 事件订阅方法 → 返回空卸载函数
        if (prop.startsWith('on')) {
          return () => () => {};
        }
        // 继续返回深层 proxy
        return makeDeepProxy(newPath);
      },
      apply(_target, _thisArg, _args) {
        const name = path.join('.');
        console.warn(`[IPC stub] ${name}() — preload not available`);
        return Promise.resolve(null);
      },
    });
  }
  return makeDeepProxy() as unknown as AbyssalAPI;
}

let _cachedAPI: AbyssalAPI | null = null;

/**
 * 获取 AbyssalAPI 实例
 *
 * 在 Electron 环境中返回真实 preload API；
 * 在非 Electron 环境中（Vite dev server 独立运行、单元测试）返回 stub。
 */
export function getAPI(): AbyssalAPI {
  if (_cachedAPI) return _cachedAPI;

  if (window.abyssal) {
    _cachedAPI = window.abyssal;
  } else {
    console.warn(
      '[Abyssal] IPC bridge not available — running in stub mode. ' +
      'IPC calls will be no-ops. Start via "npm run dev" for full functionality.'
    );
    _cachedAPI = createStubAPI();
  }

  return _cachedAPI;
}
