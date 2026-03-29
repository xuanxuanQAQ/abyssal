// ═══ 嵌入模型变更迁移 ═══
// §四: 全量重嵌入的断点续传执行

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';
import type { Logger } from '../../infra/logger';
import { EmbeddingMigrationError } from '../../types/errors';
import {
  loadOrCreateCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  detectPendingMigration,
} from './migration-checkpoint';
import { estimateMigration, type MigrationEstimate } from './migration-estimator';

// ─── 嵌入函数类型 ───

/** 由 LlmClient 提供的嵌入函数 */
export type EmbedFunction = (texts: string[]) => Promise<number[][]>;

// ─── 一致性检查结果 ───

export interface EmbeddingConsistencyResult {
  consistent: boolean;
  existingDim?: number;
  configDim?: number;
  existingModel?: string;
  configModel?: string;
  action?: 'embedding_migration_required' | 'embedding_migration_recommended';
  message?: string;
}

// ─── 进度回调 ───

export interface MigrationProgress {
  processed: number;
  totalChunks: number;
  percentage: string;
}

export type ProgressCallback = (progress: MigrationProgress) => void;

// ─── 一致性检查 ───

/**
 * §4.1: 检查数据库中已有向量与配置的嵌入维度/模型一致性。
 *
 * 返回结构化结果供 config-validator Level 8 使用。
 */
export function checkEmbeddingConsistency(
  db: Database.Database,
  config: AbyssalConfig,
): EmbeddingConsistencyResult {
  // 检查 _meta 表是否存在
  try {
    const dimRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;

    if (!dimRow) {
      return { consistent: true }; // 新项目或无 _meta 记录
    }

    const existingDim = parseInt(dimRow.value, 10);
    const configDim = config.rag.embeddingDimension;

    if (Number.isNaN(existingDim)) {
      return { consistent: true }; // 损坏的元数据，跳过
    }

    if (existingDim !== configDim) {
      return {
        consistent: false,
        existingDim,
        configDim,
        action: 'embedding_migration_required',
        message: `Embedding dimension mismatch: database has ${existingDim}D vectors, ` +
          `config specifies ${configDim}D. Migration required.`,
      };
    }

    // 维度一致——检查模型
    const modelRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_model'",
    ).get() as { value: string } | undefined;

    if (modelRow && modelRow.value !== config.rag.embeddingModel) {
      return {
        consistent: false,
        existingDim,
        configDim,
        existingModel: modelRow.value,
        configModel: config.rag.embeddingModel,
        action: 'embedding_migration_recommended',
        message: `Embedding model changed from "${modelRow.value}" to "${config.rag.embeddingModel}". ` +
          `Dimensions match but vector semantics may differ. Migration recommended.`,
      };
    }

    return { consistent: true };
  } catch {
    // _meta 表不存在——旧版数据库
    return { consistent: true };
  }
}

// ─── 迁移预估 ───

/**
 * 预估迁移的费用和时间。
 */
export function estimateEmbeddingMigration(
  db: Database.Database,
  config: AbyssalConfig,
): MigrationEstimate {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
  const totalChunks = countRow.count;

  // 获取旧值
  let oldDim: number | undefined;
  let oldModel: string | undefined;
  try {
    const dimRow = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_dimension'").get() as { value: string } | undefined;
    const modelRow = db.prepare("SELECT value FROM _meta WHERE key = 'embedding_model'").get() as { value: string } | undefined;
    oldDim = dimRow ? parseInt(dimRow.value, 10) : undefined;
    oldModel = modelRow?.value;
  } catch {
    // _meta 不存在
  }

  return estimateMigration(config, totalChunks, oldDim, oldModel);
}

// ─── 迁移执行 ───

/**
 * §4.3: 执行嵌入模型变更迁移。
 *
 * 流程：
 * 1. 创建/恢复检查点
 * 2. 重建 chunks_vec 虚拟表（首次执行时）
 * 3. 分批重嵌入——每批在单事务中写入
 * 4. 更新 _meta 元信息
 * 5. 清理检查点
 *
 * TODO — embedder 由 LlmClient.embed() 提供，当前为注入参数
 */
export async function executeEmbeddingMigration(
  db: Database.Database,
  config: AbyssalConfig,
  embedder: EmbedFunction,
  workspaceDir: string,
  logger: Logger,
  onProgress?: ProgressCallback,
): Promise<void> {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
  const totalChunks = countRow.count;

  if (totalChunks === 0) {
    // 没有 chunk 需要重嵌入——仅更新元信息
    updateMetaInfo(db, config);
    logger.info('No chunks to migrate, updated meta info only');
    return;
  }

  // Step 1: 检查是否有未完成的迁移
  let checkpoint = detectPendingMigration(
    workspaceDir,
    config.rag.embeddingModel,
    config.rag.embeddingDimension,
  );
  let lastProcessedRowid: number;

  if (checkpoint) {
    lastProcessedRowid = checkpoint.lastProcessedRowid;
    logger.info('Resuming pending embedding migration', {
      lastProcessedRowid,
      totalChunks: checkpoint.totalChunks,
    });
  } else {
    checkpoint = loadOrCreateCheckpoint(
      workspaceDir,
      totalChunks,
      config.rag.embeddingModel,
      config.rag.embeddingDimension,
    );
    lastProcessedRowid = 0;

    // Step 2: WAL 检查点
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // WAL 检查点失败不阻断迁移
    }

    // Step 3: Blue-green deployment — create NEW table, keep old alive for RAG during migration
    db.exec('DROP TABLE IF EXISTS chunks_vec_new');
    db.exec(
      `CREATE VIRTUAL TABLE chunks_vec_new USING vec0(
        embedding float[${config.rag.embeddingDimension}]
      )`,
    );
    logger.info('Created chunks_vec_new (blue-green)', { dim: config.rag.embeddingDimension });
  }

  // Step 4: 分批重嵌入 — write to chunks_vec_new (old chunks_vec still serves RAG queries)
  const batchSize = 100;
  let processed = lastProcessedRowid > 0
    ? (db.prepare('SELECT COUNT(*) as c FROM chunks WHERE rowid <= ?').get(lastProcessedRowid) as { c: number }).c
    : 0;

  const selectStmt = db.prepare(
    'SELECT rowid, text FROM chunks WHERE rowid > ? ORDER BY rowid LIMIT ?',
  );
  const insertStmt = db.prepare(
    'INSERT INTO chunks_vec_new (rowid, embedding) VALUES (?, ?)',
  );

  while (true) {
    const batch = selectStmt.all(lastProcessedRowid, batchSize) as Array<{
      rowid: number;
      text: string;
    }>;

    if (batch.length === 0) break;

    // 生成嵌入
    const texts = batch.map((c) => c.text);
    let embeddings: number[][];
    try {
      embeddings = await embedder(texts);
    } catch (err) {
      throw new EmbeddingMigrationError({
        message: `Embedding generation failed at rowid ${lastProcessedRowid}: ${(err as Error).message}`,
        cause: err instanceof Error ? err : undefined,
        context: { lastProcessedRowid, batchSize },
      });
    }

    // 写入 chunks_vec（单事务）
    const insertTransaction = db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        const vec = new Float32Array(embeddings[i]!);
        insertStmt.run(batch[i]!.rowid, Buffer.from(vec.buffer));
      }
    });
    insertTransaction();

    // 更新检查点
    lastProcessedRowid = batch[batch.length - 1]!.rowid;
    processed += batch.length;

    checkpoint.lastProcessedRowid = lastProcessedRowid;
    saveCheckpoint(workspaceDir, checkpoint);

    // 进度报告
    const percentage = ((processed / totalChunks) * 100).toFixed(1);
    logger.info('Migration progress', { processed, totalChunks, progress: `${percentage}%` });
    onProgress?.({ processed, totalChunks, percentage });
  }

  // Step 5: Atomic swap — drop old table, rename new table (millisecond-level downtime)
  db.exec('DROP TABLE IF EXISTS chunks_vec');
  db.exec('ALTER TABLE chunks_vec_new RENAME TO chunks_vec');
  logger.info('Blue-green swap completed: chunks_vec_new → chunks_vec');

  // Step 6: 更新元信息
  updateMetaInfo(db, config);

  // Step 7: 清理检查点
  deleteCheckpoint(workspaceDir);

  logger.info('Embedding migration completed', { totalChunks: processed });
}

// ─── 内部工具 ───

function updateMetaInfo(db: Database.Database, config: AbyssalConfig): void {
  db.prepare(
    `INSERT INTO _meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('embedding_model', config.rag.embeddingModel);

  db.prepare(
    `INSERT INTO _meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('embedding_dimension', String(config.rag.embeddingDimension));
}
