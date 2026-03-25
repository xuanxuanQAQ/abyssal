// ═══ 快照与备份 ═══
// §12: createSnapshot / restoreSnapshot / cleanupSnapshots

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { walCheckpoint } from './connection';
import type { Logger } from '../infra/logger';

// ─── 快照元信息 ───

export interface SnapshotMeta {
  name: string;
  createdAt: string;
  reason: string;
  sizeBeforeCompression: number;
  sizeAfterCompression: number;
  userVersion: number;
}

// ─── §12.1 创建快照 ───

export function createSnapshot(
  db: Database.Database,
  snapshotsDir: string,
  logger: Logger,
  options: { name?: string; reason?: string } = {},
): { snapshotPath: string; meta: SnapshotMeta } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = options.name ?? timestamp;
  const reason = options.reason ?? 'manual';

  // 步骤 1：WAL checkpoint
  walCheckpoint(db);
  logger.info('WAL checkpoint completed for snapshot');

  // 步骤 2：在线热备份
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const tempBackupPath = path.join(snapshotsDir, `_tmp_${timestamp}.db`);

  // Fix: 移除未 await 的 db.backup() 调用（会与 VACUUM INTO 竞争）。
  // 使用 VACUUM INTO 作为同步备份方案；失败时回退到文件拷贝。
  try {
    db.exec(`VACUUM INTO '${tempBackupPath.replace(/'/g, "''")}'`);
  } catch {
    // 如果 VACUUM INTO 失败（旧版 SQLite），尝试文件拷贝
    const dbPath = db.name;
    fs.copyFileSync(dbPath, tempBackupPath);
  }

  const sizeBeforeCompression = fs.statSync(tempBackupPath).size;

  // 步骤 3：Brotli 压缩
  const compressedPath = path.join(
    snapshotsDir,
    `${timestamp}_${name}.db.br`,
  );
  const raw = fs.readFileSync(tempBackupPath);
  const compressed = zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6, // 平衡速度和压缩比
    },
  });
  fs.writeFileSync(compressedPath, compressed);

  // 清理临时文件
  fs.unlinkSync(tempBackupPath);

  const sizeAfterCompression = compressed.byteLength;

  // 步骤 4：元信息
  const userVersionRow = db.pragma('user_version') as [{ user_version: number }];
  const userVersion = userVersionRow[0]?.user_version ?? 0;

  const meta: SnapshotMeta = {
    name,
    createdAt: new Date().toISOString(),
    reason,
    sizeBeforeCompression,
    sizeAfterCompression,
    userVersion,
  };

  const metaPath = compressedPath.replace(/\.db\.br$/, '.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  logger.info('Snapshot created', {
    path: compressedPath,
    sizeBeforeCompression,
    sizeAfterCompression,
  });

  return { snapshotPath: compressedPath, meta };
}

// ─── §12.2 恢复快照 ───
// 注意：调用方必须先关闭当前 DatabaseService，恢复后重新初始化

export function restoreSnapshot(
  snapshotPath: string,
  targetDbPath: string,
  logger: Logger,
): void {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }

  // 读取并解压
  const compressed = fs.readFileSync(snapshotPath);
  const raw = zlib.brotliDecompressSync(compressed);

  // 备份当前数据库
  if (fs.existsSync(targetDbPath)) {
    const bakPath = targetDbPath + '.bak';
    fs.renameSync(targetDbPath, bakPath);
    logger.info('Current database backed up', { bakPath });
  }

  // 清理 WAL 和 SHM 文件
  for (const suffix of ['-wal', '-shm']) {
    const walPath = targetDbPath + suffix;
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  }

  // 写入恢复的数据库
  fs.writeFileSync(targetDbPath, raw);
  logger.info('Snapshot restored', { snapshotPath, targetDbPath });
}

// ─── §12.3 空间管理 ───

export function listSnapshots(
  snapshotsDir: string,
): Array<SnapshotMeta & { filePath: string }> {
  if (!fs.existsSync(snapshotsDir)) return [];

  const files = fs.readdirSync(snapshotsDir);
  const results: Array<SnapshotMeta & { filePath: string }> = [];

  for (const f of files) {
    if (!f.endsWith('.meta.json')) continue;
    try {
      const content = fs.readFileSync(
        path.join(snapshotsDir, f),
        'utf-8',
      );
      const meta = JSON.parse(content) as SnapshotMeta;
      const dbFile = f.replace('.meta.json', '.db.br');
      results.push({
        ...meta,
        filePath: path.join(snapshotsDir, dbFile),
      });
    } catch {
      // 跳过损坏的元信息文件
    }
  }

  return results.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function cleanupSnapshots(
  snapshotsDir: string,
  maxAutoSnapshots: number = 5,
  logger: Logger,
): number {
  const snapshots = listSnapshots(snapshotsDir);

  // 手动命名的快照不清理
  const autoSnapshots = snapshots.filter(
    (s) => s.reason === 'auto' || s.reason === 'manual',
  );

  if (autoSnapshots.length <= maxAutoSnapshots) return 0;

  const toDelete = autoSnapshots.slice(maxAutoSnapshots);
  let deleted = 0;

  for (const snap of toDelete) {
    try {
      if (fs.existsSync(snap.filePath)) {
        fs.unlinkSync(snap.filePath);
      }
      const metaPath = snap.filePath.replace(/\.db\.br$/, '.meta.json');
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
      }
      deleted++;
    } catch {
      logger.warn('Failed to delete snapshot', { path: snap.filePath });
    }
  }

  logger.info('Snapshot cleanup completed', {
    deleted,
    remaining: autoSnapshots.length - deleted,
  });

  return deleted;
}
