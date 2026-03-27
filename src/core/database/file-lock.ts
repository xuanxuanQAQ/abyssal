// ═══ 文件锁 ═══
// §1.7: 防多实例并发访问同一数据库文件。
// 在 workspace/ 目录创建 .lock 文件，写入 PID + 启动时间。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseError } from '../types/errors';

export interface LockInfo {
  pid: number;
  startedAt: string;
}

/**
 * 基于文件的进程锁。
 *
 * 生命周期：
 * - acquire(): 创建 .lock 文件（检测 stale lock 并清理）
 * - release(): 删除 .lock 文件
 * - 异常退出时 stale lock 由下次启动的 acquire() 检测并清理
 */
export class FileLock {
  private readonly lockPath: string;
  private acquired = false;

  constructor(dbPath: string) {
    this.lockPath = dbPath + '.lock';
  }

  /**
   * 获取文件锁。
   *
   * 1. 检查 .lock 文件是否存在
   * 2. 如果存在：读取 PID → 检查进程是否仍在运行
   * 3. 进程仍在运行 → 抛出 DatabaseError（reason: 'locked_by_other_instance'）
   * 4. 进程不存在（stale lock）→ 删除旧 .lock 文件，创建新的
   */
  acquire(): void {
    if (this.acquired) return;

    if (fs.existsSync(this.lockPath)) {
      const existing = this.readLock();
      if (existing && this.isProcessRunning(existing.pid)) {
        throw new DatabaseError({
          message: `Database is locked by another instance (PID: ${existing.pid}, started: ${existing.startedAt})`,
          context: {
            dbPath: this.lockPath.replace(/\.lock$/, ''),
            reason: 'locked_by_other_instance',
            pid: existing.pid,
            startedAt: existing.startedAt,
          },
        });
      }
      // Stale lock — 上次崩溃留下的，安全删除
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // 删除失败不阻塞
      }
    }

    const info: LockInfo = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };

    fs.writeFileSync(this.lockPath, JSON.stringify(info), 'utf-8');
    this.acquired = true;
  }

  /** 释放文件锁（删除 .lock 文件） */
  release(): void {
    if (!this.acquired) return;
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // 释放失败不抛异常——进程即将退出
    }
    this.acquired = false;
  }

  get isAcquired(): boolean {
    return this.acquired;
  }

  // ─── 内部方法 ───

  private readLock(): LockInfo | null {
    try {
      const content = fs.readFileSync(this.lockPath, 'utf-8');
      const parsed = JSON.parse(content) as LockInfo;
      if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 检查 PID 对应的进程是否仍在运行。
   * process.kill(pid, 0) 不发送信号，仅检查进程存在性。
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
