/**
 * 单元测试 setup —— 在每个 unit project 测试文件执行前运行。
 *
 * 职责：
 *  1. 屏蔽所有外部 I/O（网络、文件系统），防止单元测试产生副作用
 *  2. 提供全局 afterEach 清理
 */
import { vi, afterEach, beforeEach } from 'vitest';
import { resetFixtureSeq } from './fixtures';

// 默认 mock fetch，单测不允许真实网络请求
globalThis.fetch = vi.fn(() => {
  throw new Error('[unit test] Real fetch is forbidden. Use vi.mocked(fetch) to stub responses.');
});

beforeEach(() => {
  resetFixtureSeq();
});

afterEach(() => {
  vi.restoreAllMocks();
});
