/**
 * 渲染进程测试 setup —— jsdom 环境，React 组件测试。
 *
 * 职责：
 *  1. mock window.abyssal（Electron preload 暴露的 IPC 桥接）
 *  2. 清理 DOM 和 mock
 */
import { vi, afterEach } from 'vitest';

// Mock Electron preload 暴露的 API，防止 "window.abyssal is undefined"
const mockAbyssalAPI = {
  db: {},
  rag: {},
  pipeline: {},
  chat: {},
  fs: {},
  app: {},
};

Object.defineProperty(globalThis, 'window', {
  value: { ...globalThis.window, abyssal: mockAbyssalAPI },
  writable: true,
});

afterEach(() => {
  vi.restoreAllMocks();
});
