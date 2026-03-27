// ═══ 嵌入模型迁移引擎 ═══
// §7: 切换嵌入模型时重建全部向量索引。
// 这是一个破坏性操作——迁移期间向量检索不可用。

import type Database from 'better-sqlite3';
import type { Logger } from '../infra/logger';
import type { AbyssalConfig } from '../types/config';

// TODO: embedder.embed(texts) 调用——依赖嵌入器服务实例注入
// TODO: computeRelationsForPaper 的 semanticSearchFn 参数需由 RAG 模块提供

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

  // 粗略估算时间（API ~500 embeddings/s，本地 ONNX ~100 embeddings/s）
  const rate = config.rag.embeddingBackend === 'api' ? 500 : 100;
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
  snapshotsDir: string;
  /**
   * 嵌入函数——由调用方注入。
   * 接受文本数组，返回对应的嵌入向量数组。
   */
  embedFn: (texts: string[]) => Promise<Float32Array[]>;
  /** 进度回调（可选） */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * 执行嵌入模型迁移。
 *
 * §7.2 步骤：
 * 1. 预估（调用方已确认）
 * 2. 创建快照
 * 3. 重建 chunks_vec 虚拟表
 * 4. 批量重新嵌入（500/事务，支持中断恢复）
 * 5. 更新 _meta
 * 6. 重算 semantic_neighbor 关系
 */
export async function runEmbeddingMigration(
  options: EmbeddingMigrationOptions,
): Promise<void> {
  const { db, config, logger, embedFn, onProgress } = options;
  const newDimension = config.rag.embeddingDimension;
  const newModel = config.rag.embeddingModel;
  const batchSize = 500;

  // ── 步骤 2：创建快照（由调用方在调用前执行，此处仅记录日志） ──
  logger.info('Starting embedding migration', {
    targetDimension: newDimension,
    targetModel: newModel,
  });

  // ── 步骤 3：蓝绿部署——创建 chunks_vec_new 而非直接 DROP 旧表 ──
  // Fix #4: 在 chunks_vec_new 后台写入期间，旧 chunks_vec 保持可用，
  // 向量搜索零停机。写入完成后原子交换表名。

  // 检查是否有中断恢复点
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

  // 影子表名：写入期间使用 chunks_vec_new
  const shadowTable = 'chunks_vec_new';

  if (lastProcessedRowid === 0) {
    // 首次执行——创建影子虚拟表（旧表保持不动）
    db.exec(`DROP TABLE IF EXISTS ${shadowTable}`);
    db.exec(
      `CREATE VIRTUAL TABLE ${shadowTable} USING vec0(embedding float[${newDimension}])`,
    );
    logger.info('Shadow table created for blue-green migration', {
      table: shadowTable,
      dimension: newDimension,
    });
  }

  // ── 步骤 4：批量重新嵌入（写入影子表） ──
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
    const embeddings = await embedFn(texts);

    // 事务内批量写入影子表
    const writeBatch = db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        insertVec.run(batch[i]!.rowid, embeddings[i]!);
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

  // ── 步骤 4.5：原子交换——蓝绿切换 ──
  // 在单个 EXCLUSIVE 事务中极速交换表名，
  // 系统不可用时间从数十分钟压缩到毫秒级。
  logger.info('Performing atomic blue-green swap');

  // 需要先删除引用 chunks_vec 的触发器
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

  // 重建触发器（引用新的 chunks_vec）
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

  // ── 步骤 6：重算 semantic_neighbor 关系 ──
  // TODO: computeRelationsForPaper 的 semanticSearchFn 参数需由 RAG 模块提供
  logger.info('Clearing stale semantic_neighbor relations');
  db.prepare(
    "DELETE FROM paper_relations WHERE edge_type = 'semantic_neighbor'",
  ).run();
  logger.info(
    'semantic_neighbor relations cleared. Recomputation requires RAG module (TODO).',
  );
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
