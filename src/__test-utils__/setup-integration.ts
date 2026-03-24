/**
 * 集成测试 setup —— 跨模块测试，使用真实 SQLite（内存模式）。
 *
 * 职责：
 *  1. 提供可复用的内存数据库创建函数
 *  2. 每个测试后清理资源
 */
import { afterEach } from 'vitest';

afterEach(() => {
  // 集成测试允许 mock，但每轮都要清理
  // 具体的 db.close() 由各测试自行管理
});
