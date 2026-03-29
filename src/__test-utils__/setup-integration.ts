/**
 * 集成测试 setup —— 跨模块测试，使用真实 SQLite（内存模式）。
 *
 * 职责：
 *  1. 每个测试前重置 fixture 序号
 *  2. 每个测试后清理 mock
 *  3. db.close() 由各测试自行管理（beforeEach/afterEach）
 */
import { afterEach, beforeEach } from 'vitest';
import { resetFixtureSeq } from './fixtures';

beforeEach(() => {
  resetFixtureSeq();
});

afterEach(() => {
  // 集成测试允许 mock，但每轮都要清理
});
