// ═══ 迁移引擎 ═══
// §3.1-3.3: user_version 检测 → 扫描 .sql/.ts 脚本 → 增量执行
//           → _meta 元信息写入 → 嵌入维度一致性检查

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MigrationError } from '../types/errors';
import type { Logger } from '../infra/logger';
import type { AbyssalConfig } from '../types/config';

// ─── 迁移脚本解析 ───

interface MigrationScript {
  version: number;
  description: string;
  fileName: string;
  /** .sql 脚本的 SQL 内容；.ts 脚本为 null */
  sql: string | null;
  /** .ts 脚本的文件路径（用于 require）；.sql 脚本为 null */
  tsPath: string | null;
}

/**
 * .ts 迁移脚本必须导出此函数签名。
 * 在 BEGIN IMMEDIATE 事务中调用，函数内可使用 db.prepare() / db.exec()。
 */
export type TsMigrateFn = (db: Database.Database, config: AbyssalConfig, skipVecExtension?: boolean) => void;

function parseMigrationFileName(
  fileName: string,
): { version: number; description: string; ext: 'sql' | 'ts' } | null {
  const match = /^(\d{3})_(.+)\.(sql|ts|js)$/.exec(fileName);
  if (!match) return null;
  return {
    version: parseInt(match[1]!, 10),
    description: match[2]!,
    // Treat .js migrations the same as .ts (compiled TypeScript)
    ext: (match[3] === 'js' ? 'ts' : match[3]) as 'sql' | 'ts',
  };
}

function loadMigrationScripts(
  migrationsDir: string,
): MigrationScript[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir).sort();
  const scripts: MigrationScript[] = [];

  for (const fileName of files) {
    const parsed = parseMigrationFileName(fileName);
    if (!parsed) continue;

    if (parsed.ext === 'sql') {
      const sql = fs.readFileSync(
        path.join(migrationsDir, fileName),
        'utf-8',
      );
      scripts.push({
        version: parsed.version,
        description: parsed.description,
        fileName,
        sql,
        tsPath: null,
      });
    } else {
      // .ts 迁移脚本
      scripts.push({
        version: parsed.version,
        description: parsed.description,
        fileName,
        sql: null,
        tsPath: path.join(migrationsDir, fileName),
      });
    }
  }

  return scripts;
}

// ─── _meta 表操作 ───

/**
 * 初始化或更新 _meta 表中的嵌入配置信息。
 * 在 001_baseline 迁移执行后调用。
 */
function seedMetaValues(
  db: Database.Database,
  config: AbyssalConfig,
): void {
  const dim = String(config.rag.embeddingDimension);
  const model = config.rag.embeddingModel;

  db.prepare(
    `INSERT INTO _meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('embedding_dimension', dim);

  db.prepare(
    `INSERT INTO _meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run('embedding_model', model);
}

/**
 * §3.3: 启动时检查 _meta.embedding_dimension 与配置一致性。
 *
 * 当维度/模型变化时（用户在设置中切换 embedding provider），自动执行
 * "嵌入迁移"：drop/recreate chunks_vec + 更新 _meta。
 * 不再抛出 DimensionMismatchError——这是正常的配置变更流程。
 */
function checkDimensionConsistency(
  db: Database.Database,
  config: AbyssalConfig,
  logger: Logger,
  skipVecExtension: boolean = false,
): void {
  // _meta 表可能不存在（旧数据库未执行 003 迁移）
  try {
    const row = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;

    if (!row) return; // 无记录——首次初始化，跳过检查

    const storedDim = parseInt(row.value, 10);
    const configDim = config.rag.embeddingDimension;

    if (Number.isNaN(storedDim)) {
      logger.warn('Corrupt _meta.embedding_dimension value, re-seeding', {
        rawValue: row.value,
      });
      seedMetaValues(db, config);
      return;
    }

    // 模型一致性检查
    const modelRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_model'",
    ).get() as { value: string } | undefined;

    const dimChanged = storedDim !== configDim;
    const modelChanged = modelRow != null && modelRow.value !== config.rag.embeddingModel;

    if (dimChanged || modelChanged) {
      logger.warn('Embedding config changed — performing automatic embedding migration', {
        storedDimension: storedDim,
        configDimension: configDim,
        storedModel: modelRow?.value,
        configModel: config.rag.embeddingModel,
        dimChanged,
        modelChanged,
      });

      // 1. Drop and recreate chunks_vec with new dimension
      if (!skipVecExtension) {
        try {
          const vecExists = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'",
          ).get();
          if (vecExists) {
            db.exec('DROP TABLE chunks_vec');
            logger.info('Dropped chunks_vec (old dimension)');
          }
          db.exec(
            `CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${configDim}])`,
          );
          logger.info('Recreated chunks_vec with new dimension', { dimension: configDim });
        } catch (vecErr) {
          logger.error('Failed to recreate chunks_vec', vecErr instanceof Error ? vecErr : undefined);
          // Non-fatal: vector search will be unavailable until manual fix
        }
      }

      // 2. Update _meta to reflect new config
      seedMetaValues(db, config);
      logger.info('_meta updated with new embedding config', {
        dimension: configDim,
        model: config.rag.embeddingModel,
      });

      // Note: existing chunks still have text but no vectors — papers need
      // re-processing to regenerate embeddings. This happens naturally when
      // the user triggers "reprocess" or the next analysis run.
    }
  } catch (err) {
    // _meta 表不存在——旧版数据库，忽略
    logger.debug('checkDimensionConsistency skipped: ' + (err as Error).message);
  }
}

// ─── 结构化维度检查结果 ───

export interface DimensionCheckResult {
  consistent: boolean;
  existingDim?: number;
  configDim?: number;
  existingModel?: string;
  configModel?: string;
  action?: 'embedding_migration_required' | 'embedding_migration_recommended';
  message?: string;
}

/**
 * 返回结构化的维度/模型一致性检查结果。
 * 供 config-validator Level 8 使用——不抛异常。
 */
export function checkEmbeddingDimensionStructured(
  db: Database.Database,
  config: AbyssalConfig,
): DimensionCheckResult {
  try {
    const dimRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;

    if (!dimRow) return { consistent: true };

    const storedDim = parseInt(dimRow.value, 10);
    const configDim = config.rag.embeddingDimension;

    if (Number.isNaN(storedDim)) return { consistent: true };

    if (storedDim !== configDim) {
      return {
        consistent: false,
        existingDim: storedDim,
        configDim,
        action: 'embedding_migration_required',
        message: `Embedding dimension mismatch: database has ${storedDim}D, config specifies ${configDim}D. Migration required.`,
      };
    }

    const modelRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_model'",
    ).get() as { value: string } | undefined;

    if (modelRow && modelRow.value !== config.rag.embeddingModel) {
      return {
        consistent: false,
        existingDim: storedDim,
        configDim,
        existingModel: modelRow.value,
        configModel: config.rag.embeddingModel,
        action: 'embedding_migration_recommended',
        message: `Embedding model changed: "${modelRow.value}" → "${config.rag.embeddingModel}". Dimensions match but semantics differ.`,
      };
    }

    return { consistent: true };
  } catch {
    return { consistent: true }; // _meta 表不存在
  }
}

// ─── 公开接口 ───

/**
 * 执行增量 Schema 迁移。
 *
 * 1. 读取 PRAGMA user_version
 * 2. 扫描 migrationsDir 中版本号 > currentVersion 的 .sql / .ts 脚本
 * 3. 每个脚本在 BEGIN IMMEDIATE 事务中执行
 * 4. 执行后更新 user_version
 * 5. baseline 迁移后回填 _meta 元信息
 * 6. 检查 _meta.embedding_dimension 与配置一致性
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string,
  config: AbyssalConfig,
  logger: Logger,
  skipVecExtension: boolean = false,
): void {
  const currentVersionRow = db.pragma('user_version') as
    | [{ user_version: number }]
    | [];
  const currentVersion =
    currentVersionRow.length > 0 ? currentVersionRow[0]!.user_version : 0;

  logger.info('Current schema version', { currentVersion });

  const scripts = loadMigrationScripts(migrationsDir);
  const pending = scripts.filter((s) => s.version > currentVersion);

  if (pending.length === 0) {
    logger.info('Schema is up to date');
    // 即使无待执行迁移，也检查维度一致性
    checkDimensionConsistency(db, config, logger, skipVecExtension);
    return;
  }

  // 按版本号升序
  pending.sort((a, b) => a.version - b.version);

  for (const script of pending) {
    logger.info('Applying migration', {
      version: script.version,
      description: script.description,
      type: script.tsPath ? 'ts' : 'sql',
    });

    try {
      if (script.sql !== null) {
        // ── SQL 迁移 ──
        executeSqlMigration(db, script, config, skipVecExtension);
      } else if (script.tsPath !== null) {
        // ── TypeScript 迁移 ──
        executeTsMigration(db, script, config, skipVecExtension);
      }
    } catch (err) {
      throw new MigrationError({
        message: `Migration ${script.fileName} failed: ${(err as Error).message}`,
        context: {
          dbPath: db.name,
          fromVersion: currentVersion,
          toVersion: script.version,
          fileName: script.fileName,
          failedStatement: (err as Error).message.slice(0, 200),
        },
        cause: err as Error,
      });
    }

    // baseline 迁移执行后回填 _meta 值
    if (script.version === 1) {
      try {
        seedMetaValues(db, config);
        logger.info('_meta values seeded', {
          dimension: config.rag.embeddingDimension,
          model: config.rag.embeddingModel,
        });
      } catch (err) {
        logger.warn('Failed to seed _meta values', {
          error: (err as Error).message,
        });
      }
    }

    logger.info('Migration applied', { version: script.version });
  }

  logger.info('All migrations completed', {
    fromVersion: currentVersion,
    toVersion: pending[pending.length - 1]!.version,
  });

  // §8.3: 迁移完成后执行 ANALYZE 更新索引统计信息
  try {
    db.exec('ANALYZE');
    logger.info('ANALYZE completed after migration');
  } catch (err) {
    logger.warn('ANALYZE failed after migration', {
      error: (err as Error).message,
    });
  }

  // 检查维度一致性
  checkDimensionConsistency(db, config, logger, skipVecExtension);
}

// ─── SQL 迁移执行 ───

function executeSqlMigration(
  db: Database.Database,
  script: MigrationScript,
  config: AbyssalConfig,
  skipVecExtension: boolean,
): void {
  // §3.3: chunks_vec 维度占位符替换
  const dimension = config.rag.embeddingDimension;
  let sql = script.sql!.replace(
    /\{EMBEDDING_DIMENSION\}/g,
    String(dimension),
  );

  // skipVecExtension 时移除 vec0 虚拟表和相关触发器
  if (skipVecExtension) {
    sql = sql
      .replace(
        /CREATE\s+VIRTUAL\s+TABLE\s+chunks_vec\s+USING\s+vec0\s*\([^)]*\)\s*;/gi,
        '-- [skipped] chunks_vec (vec0 not available)',
      )
      .replace(
        /CREATE\s+TRIGGER\s+trg_chunks_before_delete[\s\S]*?END\s*;/gi,
        '-- [skipped] trg_chunks_before_delete (vec0 not available)',
      );
  }

  // BEGIN IMMEDIATE → 执行 → 更新 user_version → COMMIT
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.pragma(`user_version = ${script.version}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ─── TypeScript 迁移执行 ───

function executeTsMigration(
  db: Database.Database,
  script: MigrationScript,
  config: AbyssalConfig,
  skipVecExtension: boolean = false,
): void {
  const mod = require(script.tsPath!) as { migrate?: TsMigrateFn };

  if (typeof mod.migrate !== 'function') {
    throw new Error(
      `TypeScript migration ${script.fileName} must export a "migrate(db, config)" function`,
    );
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    mod.migrate(db, config, skipVecExtension);
    db.pragma(`user_version = ${script.version}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
