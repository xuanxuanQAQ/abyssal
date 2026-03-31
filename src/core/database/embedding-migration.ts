// ═══ 嵌入模型迁移引擎 ═══
// §7: 切换嵌入模型时重建全部向量索引。
//
// 蓝绿部署：迁移期间写入影子表 chunks_vec_new，旧表保持可用，
// 完成后原子交换表名，向量检索几乎零停机。

import type Database from 'better-sqlite3';
import type { Logger } from '../infra/logger';
import type { AbyssalConfig } from '../types/config';
import type { EmbedFunction } from '../types/common';

// ─── §7.0 一致性检查 ───

export interface EmbeddingConsistencyResult {
  consistent: boolean;
  existingDim?: number;
  configDim?: number;
  existingModel?: string;
  configModel?: string;
  action?: 'embedding_migration_required' | 'embedding_migration_recommended';
  message?: string;
}

/**
 * 检查数据库中已有向量与配置的嵌入维度/模型一致性。
 * 返回结构化结果供 config-validator 使用。
 */
export function checkEmbeddingConsistency(
  db: Database.Database,
  config: AbyssalConfig,
): EmbeddingConsistencyResult {
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

// ─── §7.1 预估 ───

export interface MigrationEstimate {
  totalChunks: number;
  /** API 模式下的预估 API 调用次数（batch size 2048） */
  estimatedApiCalls: number;
  /** 预估时间描述 */
  estimatedTimeDescription: string;
  currentDimension: number;
  targetDimension: number;
  currentModel: string;
  targetModel: string;
}

/**
 * 预估嵌入迁移的工作量。
 * 显示预估结果供研究者确认后再执行。
 */
export function estimateEmbeddingMigration(
  db: Database.Database,
  config: AbyssalConfig,
): MigrationEstimate {
  const totalChunks = (
    db.prepare('SELECT COUNT(*) AS cnt FROM chunks').get() as { cnt: number }
  ).cnt;

  const estimatedApiCalls = Math.ceil(totalChunks / 2048);

  // 读取当前维度信息
  let currentDimension = config.rag.embeddingDimension;
  let currentModel = config.rag.embeddingModel;
  try {
    const dimRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;
    if (dimRow) {
      const parsed = parseInt(dimRow.value, 10);
      if (!Number.isNaN(parsed)) currentDimension = parsed;
    }

    const modelRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_model'",
    ).get() as { value: string } | undefined;
    if (modelRow) currentModel = modelRow.value;
  } catch {
    // _meta 不存在
  }

  // 粗略估算时间（API ~500 embeddings/s）
  const rate = 500;
  const seconds = Math.ceil(totalChunks / rate);
  const minutes = Math.ceil(seconds / 60);
  const estimatedTimeDescription =
    minutes <= 1 ? '< 1 minute' : `~${minutes} minutes`;

  return {
    totalChunks,
    estimatedApiCalls,
    estimatedTimeDescription,
    currentDimension,
    targetDimension: config.rag.embeddingDimension,
    currentModel,
    targetModel: config.rag.embeddingModel,
  };
}

// ─── §7.2 迁移执行 ───

export interface EmbeddingMigrationOptions {
  db: Database.Database;
  config: AbyssalConfig;
  logger: Logger;
  /** 嵌入函数——由 LlmClient.asEmbedFunction() 提供 */
  embedFn: EmbedFunction;
  /** 进度回调（可选） */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * 执行嵌入模型迁移。
 *
 * 步骤：
 * 1. 检查中断恢复点
 * 2. 创建影子虚拟表 (chunks_vec_new)
 * 3. 批量重新嵌入（2048/事务，与 API batch 上限对齐，支持中断恢复）
 * 4. 原子交换表名（蓝绿切换）
 * 5. 更新 _meta
 * 6. 清除过期 semantic_neighbor 关系
 */
export async function runEmbeddingMigration(
  options: EmbeddingMigrationOptions,
): Promise<void> {
  const { db, config, logger, embedFn, onProgress } = options;
  const newDimension = config.rag.embeddingDimension;
  const newModel = config.rag.embeddingModel;
  // Fix #11: 增大批次以减少事务开销（embedder API batch 上限 2048，对齐之）
  const batchSize = 2048;

  logger.info('Starting embedding migration', {
    targetDimension: newDimension,
    targetModel: newModel,
  });

  // ── 步骤 1：检查中断恢复点 ──
  let lastProcessedRowid = 0;
  try {
    const resumeRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'migration_last_rowid'",
    ).get() as { value: string } | undefined;
    if (resumeRow) {
      const parsed = parseInt(resumeRow.value, 10);
      if (!Number.isNaN(parsed)) {
        lastProcessedRowid = parsed;
        logger.info('Resuming embedding migration', { fromRowid: lastProcessedRowid });
      }
    }
  } catch {
    // _meta 不存在或无记录——从头开始
  }

  // ── 步骤 2：蓝绿部署——创建影子虚拟表 ──
  const shadowTable = 'chunks_vec_new';

  if (lastProcessedRowid === 0) {
    db.exec(`DROP TABLE IF EXISTS ${shadowTable}`);
    db.exec(
      `CREATE VIRTUAL TABLE ${shadowTable} USING vec0(embedding float[${newDimension}])`,
    );
    logger.info('Shadow table created for blue-green migration', {
      table: shadowTable,
      dimension: newDimension,
    });
  }

  // ── 步骤 3：批量重新嵌入（写入影子表） ──
  const totalChunks = (
    db.prepare('SELECT COUNT(*) AS cnt FROM chunks').get() as { cnt: number }
  ).cnt;

  const selectBatch = db.prepare(
    'SELECT rowid, text FROM chunks WHERE rowid > ? ORDER BY rowid LIMIT ?',
  );
  const insertVec = db.prepare(
    `INSERT INTO ${shadowTable} (rowid, embedding) VALUES (?, ?)`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO _meta (key, value) VALUES ('migration_last_rowid', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  let processed = lastProcessedRowid > 0
    ? (db.prepare(
        'SELECT COUNT(*) AS cnt FROM chunks WHERE rowid <= ?',
      ).get(lastProcessedRowid) as { cnt: number }).cnt
    : 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = selectBatch.all(lastProcessedRowid, batchSize) as Array<{
      rowid: number;
      text: string;
    }>;

    if (batch.length === 0) break;

    const texts = batch.map((r) => r.text);
    const embeddings = await embedFn.embed(texts);

    // 事务内批量写入影子表 + 更新检查点
    const writeBatch = db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        const vec = embeddings[i]!;
        insertVec.run(batch[i]!.rowid, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
      }
      const lastRowid = batch[batch.length - 1]!.rowid;
      upsertMeta.run(String(lastRowid));
    });
    writeBatch();

    lastProcessedRowid = batch[batch.length - 1]!.rowid;
    processed += batch.length;
    onProgress?.(processed, totalChunks);

    logger.info('Embedding migration progress', {
      processed,
      total: totalChunks,
      lastRowid: lastProcessedRowid,
    });

    // 释放事件循环——避免长时间阻塞
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  // ── 步骤 4：原子交换——蓝绿切换 ──
  logger.info('Performing atomic blue-green swap');

  db.exec(`DROP TRIGGER IF EXISTS trg_chunks_before_delete`);

  db.exec('BEGIN EXCLUSIVE');
  try {
    db.exec('DROP TABLE IF EXISTS chunks_vec');
    db.exec(`ALTER TABLE ${shadowTable} RENAME TO chunks_vec`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // 重建触发器
  db.exec(`
    CREATE TRIGGER trg_chunks_before_delete BEFORE DELETE ON chunks
    FOR EACH ROW
    BEGIN
      DELETE FROM chunks_vec WHERE rowid = OLD.rowid;
    END
  `);

  logger.info('Blue-green swap completed');

  // ── 步骤 5：更新 _meta ──
  db.prepare(
    `INSERT INTO _meta (key, value) VALUES ('embedding_dimension', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(newDimension));

  db.prepare(
    `INSERT INTO _meta (key, value) VALUES ('embedding_model', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(newModel);

  // 清理迁移状态
  db.prepare("DELETE FROM _meta WHERE key = 'migration_last_rowid'").run();

  logger.info('Embedding migration completed', {
    totalProcessed: processed,
    dimension: newDimension,
    model: newModel,
  });

  // ── 步骤 6：清除过期 semantic_neighbor 关系 ──
  logger.info('Clearing stale semantic_neighbor relations');
  db.prepare(
    "DELETE FROM paper_relations WHERE edge_type = 'semantic_neighbor'",
  ).run();
  logger.info('semantic_neighbor relations cleared — will be rebuilt on next RAG query');
}

// ─── §7.3 中断恢复检测 ───

/**
 * 检查是否有未完成的嵌入迁移。
 *
 * 下次启动时调用——如果 _meta 中存在 migration_last_rowid，
 * 说明迁移被中断，提示用户选择继续或回滚。
 */
export function checkPendingEmbeddingMigration(
  db: Database.Database,
): { pending: boolean; lastProcessedRowid: number } {
  try {
    const row = db.prepare(
      "SELECT value FROM _meta WHERE key = 'migration_last_rowid'",
    ).get() as { value: string } | undefined;

    if (row) {
      const parsed = parseInt(row.value, 10);
      return {
        pending: true,
        lastProcessedRowid: Number.isNaN(parsed) ? 0 : parsed,
      };
    }
  } catch {
    // _meta 不存在
  }
  return { pending: false, lastProcessedRowid: 0 };
}
