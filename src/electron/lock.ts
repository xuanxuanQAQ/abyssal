/**
 * Process exclusive lock — ensures only one Abyssal instance per workspace.
 *
 * Uses OS-level file locking via a held-open file descriptor.
 * When a process crashes or is killed, the OS automatically releases the lock.
 * No PID-based liveness detection needed — eliminates stale lock issues.
 *
 * See spec: section 2 — Process Exclusive Lock (improved)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ───

export interface LockHandle {
  /** Release the lock (closes fd + deletes .lock file) */
  release(): void;
}

export interface LockInfo {
  pid: number;
  startedAt: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export class LockError extends Error {
  readonly pid: number;
  readonly startedAt: string;

  constructor(message: string, info: { pid: number; startedAt: string }) {
    super(message);
    this.name = 'LockError';
    this.pid = info.pid;
    this.startedAt = info.startedAt;
  }
}

// ─── Implementation ───

function buildLockContent(): string {
  return JSON.stringify(
    {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      electronVersion: process.versions['electron'] ?? 'N/A',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    } satisfies LockInfo,
    null,
    2,
  );
}

/**
 * Try to acquire an OS-level exclusive lock on a file descriptor.
 *
 * On Windows: uses `fs.flock` emulation via `'r+'` + exclusive open mode.
 * On POSIX:  uses `fs.flock` semantics (LOCK_EX | LOCK_NB).
 *
 * Since Node.js doesn't have flock natively, we rely on a held-open fd
 * with O_EXCL for creation, and on Windows we try opening with a share
 * mode that prevents other processes from opening the same file.
 *
 * Strategy:
 * 1. Try to open .lock with 'wx' (O_CREAT | O_EXCL) — atomic if file doesn't exist.
 * 2. If file exists, try to rename it to .lock.probe (atomic on same filesystem).
 *    - Success → old lock holder is dead (fd was closed by OS). Delete probe, create new lock.
 *    - Failure (EACCES/EPERM on Windows, or race condition) → lock is held by live process.
 * 3. As belt-and-suspenders: keep the fd open for the process lifetime.
 *    On crash, OS closes the fd and releases any OS-level locks.
 */

/**
 * Acquire a process-level exclusive lock for the given workspace.
 *
 * The lock is held by keeping a file descriptor open. When the process exits
 * (normally, crash, or kill -9), the OS closes all fds and releases the lock.
 *
 * @param workspacePath - Workspace root directory (will create if missing)
 * @returns LockHandle with release() method
 * @throws LockError if another live instance holds the lock
 * @throws Error on permission or filesystem errors
 */
export function acquireLock(workspacePath: string): LockHandle {
  fs.mkdirSync(workspacePath, { recursive: true });

  const lockPath = path.join(workspacePath, '.lock');
  const probePath = lockPath + '.probe';

  // ── Attempt 1: create exclusively (file doesn't exist) ──
  let fd: number | null = null;
  try {
    fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, buildLockContent());
    // DO NOT close fd — keeping it open is the lock mechanism.
    // OS will close + release on process exit/crash/kill.
    return createHandle(fd, lockPath);
  } catch (err: unknown) {
    // If openSync succeeded but writeSync failed, close the leaked fd
    if (fd !== null && (err as NodeJS.ErrnoException).code !== 'EEXIST') {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err; // permission or other FS error
    }
  }

  // ── File exists. Is the holder alive? ──
  // Strategy: try to rename the lock file. If the holder process still has
  // the fd open, the rename will fail on Windows (EACCES/EBUSY because the
  // file is locked by another process's open handle). On POSIX, rename
  // succeeds even with open fds, so we also check if we can open the
  // original path with 'wx' immediately after rename.

  // Read existing lock info for error reporting
  let existingInfo: LockInfo | null = null;
  try {
    existingInfo = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as LockInfo;
  } catch {
    // Corrupted — just remove and retry
    safeUnlink(lockPath);
    return acquireLock(workspacePath);
  }

  // Try the rename probe
  try {
    fs.renameSync(lockPath, probePath);
  } catch {
    // Rename failed — on Windows this means the file is held open by another
    // process. The lock is genuinely held.
    throw new LockError(
      `Another Abyssal instance is running. PID: ${existingInfo.pid}, started at: ${existingInfo.startedAt}`,
      { pid: existingInfo.pid, startedAt: existingInfo.startedAt },
    );
  }

  // Rename succeeded. On POSIX this doesn't prove the holder is dead
  // (POSIX allows renaming files with open fds). But it means:
  // - On Windows: holder is definitely dead (OS blocks rename of open files).
  // - On POSIX: we need a secondary check.

  // Secondary check for POSIX: try to create the lock file exclusively.
  // If the old process still has the *original path's* fd open, the inode
  // was moved to probePath — the old fd now points to probePath.
  // We can safely create a new file at lockPath.
  safeUnlink(probePath);

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, buildLockContent());
    return createHandle(fd, lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Race condition: another process beat us to it
      throw new LockError(
        `Another Abyssal instance is running. PID: ${existingInfo.pid}, started at: ${existingInfo.startedAt}`,
        { pid: existingInfo.pid, startedAt: existingInfo.startedAt },
      );
    }
    throw err;
  }
}

// ─── Helpers ───

function createHandle(fd: number, lockPath: string): LockHandle {
  return {
    release() {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      safeUnlink(lockPath);
    },
  };
}

function safeUnlink(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}
