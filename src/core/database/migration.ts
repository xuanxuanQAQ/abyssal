// ═══ 迁移引擎 ═══
// §2.1: user_version 检测 → 扫描脚本 → 增量执行

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
  sql: string;
}

function parseMigrationFileName(
  fileName: string,
): { version: number; description: string } | null {
  const match = /^(\d{3})_(.+)\.sql$/.exec(fileName);
  if (!match) return null;
  return {
    version: parseInt(match[1]!, 10),
    description: match[2]!,
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
    const sql = fs.readFileSync(
      path.join(migrationsDir, fileName),
      'utf-8',
    );
    scripts.push({
      version: parsed.version,
      description: parsed.description,
      fileName,
      sql,
    });
  }

  return scripts;
}

// ─── 公开接口 ───

/**
 * 执行增量 Schema 迁移。
 *
 * 1. 读取 PRAGMA user_version
 * 2. 扫描 migrationsDir 中版本号 > currentVersion 的脚本
 * 3. 每个脚本在 BEGIN IMMEDIATE 事务中执行
 * 4. 执行后更新 user_version
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
    return;
  }

  // 按版本号升序
  pending.sort((a, b) => a.version - b.version);

  for (const script of pending) {
    logger.info('Applying migration', {
      version: script.version,
      description: script.description,
    });

    // §2.2.8: chunks_vec 维度占位符替换
    const dimension = config.rag.embeddingDimension;
    let sql = script.sql.replace(
      /\{EMBEDDING_DIMENSION\}/g,
      String(dimension),
    );

    // skipVecExtension 时移除 vec0 虚拟表和相关触发器
    if (skipVecExtension) {
      sql = sql
        .replace(/CREATE\s+VIRTUAL\s+TABLE\s+chunks_vec\s+USING\s+vec0\s*\([^)]*\)\s*;/gi, '-- [skipped] chunks_vec (vec0 not available)')
        .replace(/CREATE\s+TRIGGER\s+trg_chunks_before_delete[\s\S]*?END\s*;/gi, '-- [skipped] trg_chunks_before_delete (vec0 not available)');
    }

    try {
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
    } catch (err) {
      throw new MigrationError({
        message: `Migration ${script.fileName} failed: ${(err as Error).message}`,
        context: {
          dbPath: db.name,
          fromVersion: currentVersion,
          toVersion: script.version,
          fileName: script.fileName,
        },
        cause: err as Error,
      });
    }

    logger.info('Migration applied', { version: script.version });
  }

  logger.info('All migrations completed', {
    fromVersion: currentVersion,
    toVersion: pending[pending.length - 1]!.version,
  });
}
