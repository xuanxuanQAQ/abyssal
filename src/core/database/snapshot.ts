// ═══ 快照与备份 ═══
// §6.1: 创建快照（TRUNCATE checkpoint → backup → zstd/brotli 压缩 → manifest）
// §6.2: 恢复快照（安全备份 → 解压 → 清理 WAL/SHM → 重新初始化 → 维度检查）
// §6.3: 空间管理（命名快照保护 + 自动清理）

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { walCheckpoint } from './connection';
import { DimensionMismatchError } from '../types/errors';
import type { Logger } from '../infra/logger';
import type { AbyssalConfig } from '../types/config';

// ─── 压缩算法选择 ───

type CompressionAlgo = 'zstd' | 'brotli';

/**
 * 检测当前 Node.js 是否支持 zstd（22+ 原生支持），
 * 不支持则回退 Brotli。
 */
function detectCompression(): CompressionAlgo {
  try {
    // Node.js 22+ 暴露 zstd 压缩常量
    if (
      typeof (zlib as Record<string, unknown>)['createZstdCompress'] === 'function'
    ) {
      return 'zstd';
    }
  } catch {
    // ignore
  }
  return 'brotli';
}

/**
 * Fix #3: 流式压缩——使用 stream.pipeline 正确处理背压，
 * 避免 800MB 数据库全量读入内存导致 OOM。
 */
async function compressFile(
  srcPath: string,
  destPath: string,
  algo: CompressionAlgo,
): Promise<void> {
  const readStream = fs.createReadStream(srcPath);
  const writeStream = fs.createWriteStream(destPath);
  const compressor =
    algo === 'zstd'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (zlib as any).createZstdCompress({ level: 6 })
      : zlib.createBrotliCompress({
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
        });
  // pipeline 正确处理背压和错误销毁，防止内存泄漏和文件句柄悬挂
  await pipeline(readStream, compressor, writeStream);
}

/**
 * Fix #3: 流式解压——同理避免 OOM。
 */
async function decompressFile(
  srcPath: string,
  destPath: string,
  algo: CompressionAlgo,
): Promise<void> {
  const readStream = fs.createReadStream(srcPath);
  const writeStream = fs.createWriteStream(destPath);
  const decompressor =
    algo === 'zstd'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (zlib as any).createZstdDecompress()
      : zlib.createBrotliDecompress();
  await pipeline(readStream, decompressor, writeStream);
}

function compressionExt(algo: CompressionAlgo): string {
  return algo === 'zstd' ? '.db.zst' : '.db.br';
}

// ─── §6.1 快照元信息 ───

export interface SnapshotMeta {
  name: string;
  timestamp: string;
  fileName: string;
  compression: CompressionAlgo;
  sizeCompressed: number;
  sizeOriginal: number;
  compressionRatio: number;
  stats: {
    paperCount: number;
    analyzedCount: number;
    conceptCount: number;
    mappingCount: number;
    chunkCount: number;
    memoCount: number;
    noteCount: number;
    schemaVersion: number;
    embeddingDimension: number;
    embeddingModel: string;
  };
  userNote: string;
}

// ─── §6.1 创建快照 ───

export async function createSnapshot(
  db: Database.Database,
  snapshotsDir: string,
  logger: Logger,
  options: { name?: string; reason?: string; pauseWorkerWrites?: (() => (() => void)) | undefined } = {},
): Promise<{ snapshotPath: string; meta: SnapshotMeta }> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const name = options.name ?? timestamp;
  const userNote = options.reason ?? '';

  // 步骤 1：WAL TRUNCATE checkpoint（含 Worker 协调）
  walCheckpoint(db, { logger, pauseWorkerWrites: options.pauseWorkerWrites });
  logger.info('WAL checkpoint completed for snapshot');

  // 步骤 2：在线热备份
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const tempBackupPath = path.join(snapshotsDir, `_tmp_${timestamp}.db`);

  try {
    // 统一使用 forward slash，避免 Windows 反斜杠在 SQLite 中的解析问题
    const safePath = tempBackupPath.replace(/\\/g, '/').replace(/'/g, "''");
    db.exec(`VACUUM INTO '${safePath}'`);
  } catch {
    // VACUUM INTO 失败（旧版 SQLite）→ 文件拷贝
    const dbPath = db.name;
    fs.copyFileSync(dbPath, tempBackupPath);
  }

  const sizeOriginal = fs.statSync(tempBackupPath).size;

  // 步骤 3：流式压缩（zstd 优先，回退 brotli）
  // Fix #3: 使用 stream.pipeline 替代全量读入内存，
  // 正确处理背压，避免大数据库 OOM。
  const algo = detectCompression();
  const ext = compressionExt(algo);
  const compressedFileName = `${timestamp}_${name}${ext}`;
  const compressedPath = path.join(snapshotsDir, compressedFileName);

  await compressFile(tempBackupPath, compressedPath, algo);

  // 清理临时文件
  fs.unlinkSync(tempBackupPath);

  const sizeCompressed = fs.statSync(compressedPath).size;

  // 步骤 4：收集统计信息生成 manifest（单次 round-trip 减少锁竞争）
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM papers) AS paper_count,
      (SELECT COUNT(*) FROM papers WHERE analysis_status = 'completed') AS analyzed_count,
      (SELECT COUNT(*) FROM concepts) AS concept_count,
      (SELECT COUNT(*) FROM paper_concept_map) AS mapping_count,
      (SELECT COUNT(*) FROM chunks) AS chunk_count,
      (SELECT COUNT(*) FROM research_memos) AS memo_count,
      (SELECT COUNT(*) FROM research_notes) AS note_count
  `).get() as Record<string, number>;
  const paperCount = counts['paper_count'] ?? 0;
  const analyzedCount = counts['analyzed_count'] ?? 0;
  const conceptCount = counts['concept_count'] ?? 0;
  const mappingCount = counts['mapping_count'] ?? 0;
  const chunkCount = counts['chunk_count'] ?? 0;
  const memoCount = counts['memo_count'] ?? 0;
  const noteCount = counts['note_count'] ?? 0;

  const userVersionRow = db.pragma('user_version') as [{ user_version: number }];
  const schemaVersion = userVersionRow[0]?.user_version ?? 0;

  // 读取嵌入信息
  let embeddingDimension = 0;
  let embeddingModel = 'unknown';
  try {
    const dimRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;
    if (dimRow) embeddingDimension = parseInt(dimRow.value, 10);
    const modelRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_model'",
    ).get() as { value: string } | undefined;
    if (modelRow) embeddingModel = modelRow.value;
  } catch {
    // _meta 不存在
  }

  const meta: SnapshotMeta = {
    name,
    timestamp: now.toISOString(),
    fileName: compressedFileName,
    compression: algo,
    sizeCompressed,
    sizeOriginal,
    compressionRatio: sizeOriginal > 0 ? sizeCompressed / sizeOriginal : 0,
    stats: {
      paperCount,
      analyzedCount,
      conceptCount,
      mappingCount,
      chunkCount,
      memoCount,
      noteCount,
      schemaVersion,
      embeddingDimension,
      embeddingModel,
    },
    userNote,
  };

  const metaPath = compressedPath.replace(/\.db\.(zst|br)$/, '.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  logger.info('Snapshot created', {
    path: compressedPath,
    compression: algo,
    sizeOriginal,
    sizeCompressed,
    compressionRatio: meta.compressionRatio.toFixed(2),
  });

  return { snapshotPath: compressedPath, meta };
}

// ─── §6.2 恢复快照 ───

export interface RestoreSnapshotOptions {
  snapshotPath: string;
  targetDbPath: string;
  logger: Logger;
  config?: AbyssalConfig | undefined;
}

/**
 * 恢复快照。
 *
 * 调用方必须先关闭当前 DatabaseService，恢复后重新初始化。
 *
 * §6.2 步骤：
 * 1. （调用方已关闭连接）
 * 2. 安全备份当前数据库 → _rollback_safety_net.db
 * 3. 解压快照
 * 4. 清理 WAL/SHM 文件
 * 5. （调用方重新初始化连接——迁移引擎检查版本兼容性）
 * 6. 嵌入维度一致性检查
 */
export async function restoreSnapshot(options: RestoreSnapshotOptions): Promise<void> {
  const { snapshotPath, targetDbPath, logger, config } = options;

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }

  // 读取 manifest 判断压缩算法
  const metaPath = snapshotPath.replace(/\.db\.(zst|br)$/, '.meta.json');
  let algo: CompressionAlgo = 'brotli';
  let snapshotMeta: SnapshotMeta | null = null;
  if (fs.existsSync(metaPath)) {
    try {
      snapshotMeta = JSON.parse(
        fs.readFileSync(metaPath, 'utf-8'),
      ) as SnapshotMeta;
      algo = snapshotMeta.compression;
    } catch {
      // 无法解析 manifest，根据扩展名推断
    }
  }
  // 根据文件扩展名回退推断
  if (!snapshotMeta) {
    algo = snapshotPath.endsWith('.zst') ? 'zstd' : 'brotli';
  }

  // §6.2 步骤 2：安全备份当前数据库
  if (fs.existsSync(targetDbPath)) {
    const safetyDir = path.dirname(targetDbPath);
    const safetyPath = path.join(safetyDir, '_rollback_safety_net.db');
    fs.copyFileSync(targetDbPath, safetyPath);
    logger.info('Current database backed up for safety', { safetyPath });
  }

  // §6.2 步骤 3：流式解压快照
  // Fix #3: 使用 stream.pipeline 替代全量读入内存
  await decompressFile(snapshotPath, targetDbPath, algo);

  // §6.2 步骤 4：清理 WAL 和 SHM 文件
  for (const suffix of ['-wal', '-shm']) {
    const filePath = targetDbPath + suffix;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  logger.info('Snapshot restored', { snapshotPath, targetDbPath, compression: algo });

  // §6.2 步骤 6：嵌入维度一致性检查（如果有 config 和 manifest）
  if (config && snapshotMeta) {
    const snapshotDim = snapshotMeta.stats.embeddingDimension;
    const configDim = config.rag.embeddingDimension;
    const snapshotModel = snapshotMeta.stats.embeddingModel;
    const configModel = config.rag.embeddingModel;

    if (snapshotDim > 0 && snapshotDim !== configDim) {
      throw new DimensionMismatchError({
        message: `Snapshot embedding dimension (${snapshotDim}) does not match config (${configDim}). ` +
          'Must run embedding migration after restore.',
        context: {
          snapshotDimension: snapshotDim,
          configDimension: configDim,
        },
      });
    }

    if (snapshotModel !== 'unknown' && snapshotModel !== configModel) {
      logger.warn('Snapshot embedding model differs from config', {
        snapshot: snapshotModel,
        config: configModel,
      });
    }
  }

  // 调用方（Electron IPC handler）负责在恢复成功后发送 'database-restored' 事件通知前端刷新。
  // 本函数是纯 core 层，不直接依赖 Electron API。
}

// ─── §6.3 空间管理 ───

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
      // 数据库文件路径从 manifest 中的 fileName 获取
      const dbFile = meta.fileName ?? f.replace('.meta.json', '.db.br');
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
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/** 判断快照名称是否为自动生成的时间戳格式 */
function isAutoName(name: string): boolean {
  // 时间戳格式：2026-03-25T14-30-00-000Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}/.test(name);
}

/**
 * 清理旧快照。
 *
 * 保留规则 (§6.1 步骤 5)：
 * - 用户命名的快照（name 非时间戳格式）永不自动清理
 * - 自动命名的快照保留最近 N 个，删除更旧的
 */
export function cleanupSnapshots(
  snapshotsDir: string,
  maxAutoSnapshots: number = 5,
  logger: Logger,
): number {
  const snapshots = listSnapshots(snapshotsDir);

  // 仅清理自动命名的快照
  const autoSnapshots = snapshots.filter((s) => isAutoName(s.name));

  if (autoSnapshots.length <= maxAutoSnapshots) return 0;

  const toDelete = autoSnapshots.slice(maxAutoSnapshots);
  let deleted = 0;

  for (const snap of toDelete) {
    try {
      // 先删 meta（小文件），再删 db（大文件）
      // 如果 db 删除失败，孤儿 db 文件无害（下次 listSnapshots 仍能发现）
      // 如果 meta 删除失败但 db 成功，listSnapshots 不会列出它（找不到 db 文件）
      const metaPath = snap.filePath.replace(/\.db\.(zst|br)$/, '.meta.json');
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
      }
      if (fs.existsSync(snap.filePath)) {
        fs.unlinkSync(snap.filePath);
      }
      deleted++;
    } catch (err) {
      logger.warn('Failed to delete snapshot', {
        path: snap.filePath,
        error: (err as Error).message,
      });
    }
  }

  logger.info('Snapshot cleanup completed', {
    deleted,
    remaining: autoSnapshots.length - deleted,
  });

  return deleted;
}
