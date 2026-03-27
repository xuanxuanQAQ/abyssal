/**
 * 集成测试用数据库工厂 — 基于 migration 系统构建 schema。
 *
 * 与旧 mock-db.ts 的区别：
 * - 使用真实的 migration 文件（001→005），保证 schema 与生产一致
 * - skipVecExtension=true 跳过 sqlite-vec（避免 ABI 冲突）
 * - 每个测试获得独立的 :memory: 实例，互不影响
 */

import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../core/database/migration';
import type { AbyssalConfig } from '../core/types/config';
import type { Logger } from '../core/infra/logger';

/** 静默 Logger——测试中不打印日志 */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** 测试用最小配置 */
export function createTestConfig(overrides?: Partial<AbyssalConfig>): AbyssalConfig {
  return {
    project: { name: 'test-project' },
    workspace: {
      baseDir: '/tmp/test-workspace',
      dbFileName: ':memory:',
      pdfDir: 'pdfs',
      textDir: 'texts',
      reportsDir: 'reports',
      notesDir: 'notes',
      exportsDir: 'exports',
      snapshotsDir: 'snapshots',
      privateDocs: 'private-docs',
    },
    acquire: {
      sources: ['semantic_scholar'],
      maxPapersPerRun: 100,
      deduplication: { strategy: 'doi_first' },
      rateLimits: {},
    },
    discovery: {
      rounds: 3,
      mode: 'balanced',
    },
    analysis: {
      defaultModel: 'claude-sonnet-4-20250514',
      concurrency: 2,
      fulltext: { preferPdf: true },
    },
    rag: {
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 4, // 极小维度，测试用
      embeddingBackend: 'api',
      chunkSize: 512,
      chunkOverlap: 64,
      topK: 10,
    },
    language: {
      primary: 'zh',
      secondary: 'en',
    },
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
      temperature: 0.3,
      maxTokens: 4096,
    },
    concepts: {
      additiveChangeLookbackDays: 30,
    },
    ...overrides,
  } as AbyssalConfig;
}

/** 迁移文件目录 */
export const MIGRATIONS_DIR = path.resolve(__dirname, '../core/database/migrations');

/**
 * 创建内存数据库并运行全部 migration。
 *
 * 使用方式：
 * ```ts
 * let db: Database.Database;
 * beforeEach(async () => { db = await createTestDB(); });
 * afterEach(() => { db.close(); });
 * ```
 */
export function createTestDB(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const config = createTestConfig();
  try {
    runMigrations(db, MIGRATIONS_DIR, config, silentLogger, /* skipVecExtension */ true);
  } catch (err) {
    db.close();
    throw new Error(`createTestDB migration failed: ${(err as Error).message}`);
  }

  return db;
}
