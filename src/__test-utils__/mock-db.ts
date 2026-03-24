/**
 * Database mock & helper —— 两种模式：
 *
 * 1. 全 mock（单元测试）：vi.mock('@core/database') + createMockDB()
 * 2. 内存 SQLite（集成测试）：createTestDB() 返回真实数据库实例
 *
 * 集成测试使用真实 SQLite 的理由：
 *   mock 数据库曾掩盖了真实的 schema 不匹配问题。
 *   内存模式不产生磁盘 I/O，速度接近 mock。
 */
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── 单元测试用：全 mock ──

export function createMockDB() {
  return {
    addPaper: vi.fn(),
    updatePaper: vi.fn(),
    getPaper: vi.fn(),
    queryPapers: vi.fn().mockReturnValue([]),
    addCitation: vi.fn(),
    syncConcepts: vi.fn(),
    mapPaperConcept: vi.fn(),
    addAnnotation: vi.fn(),
    getAnnotations: vi.fn().mockReturnValue([]),
    getConceptMatrix: vi.fn().mockReturnValue([]),
    getCitationGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
    getStats: vi.fn().mockReturnValue({ papers: 0, concepts: 0, chunks: 0 }),
    checkIntegrity: vi.fn().mockReturnValue({ ok: true }),
  };
}

// ── 集成测试用：真实内存 SQLite ──

const SCHEMA_PATH = path.resolve(__dirname, '../core/database/schema.sql');

/**
 * 创建内存数据库并初始化 schema。
 * 调用方负责在 afterEach/afterAll 中调用 db.close()。
 */
export async function createTestDB(): Promise<import('better-sqlite3').Database> {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  return db;
}
