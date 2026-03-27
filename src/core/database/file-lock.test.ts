import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileLock } from './file-lock';
import { DatabaseError } from '../types/errors';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `abyssal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('FileLock', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    // 确保 .lock 不存在
    try { fs.unlinkSync(dbPath + '.lock'); } catch { /* ok */ }
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath + '.lock'); } catch { /* ok */ }
  });

  it('acquires and releases a lock', () => {
    const lock = new FileLock(dbPath);
    expect(lock.isAcquired).toBe(false);

    lock.acquire();
    expect(lock.isAcquired).toBe(true);
    expect(fs.existsSync(dbPath + '.lock')).toBe(true);

    // 验证 lock 文件内容
    const content = JSON.parse(fs.readFileSync(dbPath + '.lock', 'utf-8'));
    expect(content.pid).toBe(process.pid);
    expect(content.startedAt).toBeTruthy();

    lock.release();
    expect(lock.isAcquired).toBe(false);
    expect(fs.existsSync(dbPath + '.lock')).toBe(false);
  });

  it('is idempotent on double acquire', () => {
    const lock = new FileLock(dbPath);
    lock.acquire();
    lock.acquire(); // 不应报错
    expect(lock.isAcquired).toBe(true);
    lock.release();
  });

  it('is idempotent on double release', () => {
    const lock = new FileLock(dbPath);
    lock.acquire();
    lock.release();
    lock.release(); // 不应报错
    expect(lock.isAcquired).toBe(false);
  });

  it('detects stale lock and cleans up', () => {
    // 写一个不存在的 PID 的 lock 文件
    const staleInfo = { pid: 999999999, startedAt: new Date().toISOString() };
    fs.writeFileSync(dbPath + '.lock', JSON.stringify(staleInfo));

    const lock = new FileLock(dbPath);
    lock.acquire(); // 应该清理 stale lock 并获取新的
    expect(lock.isAcquired).toBe(true);

    const content = JSON.parse(fs.readFileSync(dbPath + '.lock', 'utf-8'));
    expect(content.pid).toBe(process.pid); // 新 PID
    lock.release();
  });

  it('throws when lock held by live process', () => {
    // 用当前进程 PID 模拟活跃锁
    const liveInfo = { pid: process.pid, startedAt: new Date().toISOString() };
    fs.writeFileSync(dbPath + '.lock', JSON.stringify(liveInfo));

    const lock = new FileLock(dbPath);
    expect(() => lock.acquire()).toThrow(DatabaseError);
  });

  it('handles corrupted lock file gracefully', () => {
    fs.writeFileSync(dbPath + '.lock', 'not valid json!!!');

    const lock = new FileLock(dbPath);
    lock.acquire(); // 应当视为 stale lock
    expect(lock.isAcquired).toBe(true);
    lock.release();
  });
});
