/**
 * Error path integration tests — 验证损坏数据、边界条件、异常恢复。
 *
 * 这些测试覆盖的是"正常 DAO 测试不会触发"的代码路径：
 * - JSON 损坏时不 crash
 * - parseInt 遇到非数字时不误判
 * - 维度不匹配时正确抛错
 * - 事务重试机制
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB, createTestConfig, silentLogger, MIGRATIONS_DIR } from '../../../src/__test-utils__/test-db';

describe('error paths', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  // ─── JSON 损坏 ───

  describe('corrupted JSON in database', () => {
    it('getMemo with corrupted paper_ids JSON does not crash', async () => {
      const { getMemo } = await import('../../../src/core/database/dao/memos');
      const { asMemoId } = await import('../../../src/core/types/common');

      // 直接插入损坏的 JSON 数据
      db.prepare(`
        INSERT INTO research_memos (text, paper_ids, concept_ids, linked_note_ids, tags, indexed, created_at, updated_at)
        VALUES ('test', '{broken json', '[]', '[]', '[]', 0, '2026-01-01', '2026-01-01')
      `).run();

      const id = db.prepare('SELECT id FROM research_memos').get() as { id: number };

      // 不应该 crash
      const memo = getMemo(db, asMemoId(String(id.id)));
      expect(memo).not.toBeNull();
      // paper_ids 应该是原始字符串（fromRow 的 JSON.parse 失败时保留原值）
    });

    it('updateMemo with corrupted JSON in existing row uses safeParseArray fallback', async () => {
      const { updateMemo } = await import('../../../src/core/database/dao/memos');
      const { asMemoId } = await import('../../../src/core/types/common');

      // 插入损坏数据
      db.prepare(`
        INSERT INTO research_memos (text, paper_ids, concept_ids, linked_note_ids, tags, indexed, created_at, updated_at)
        VALUES ('test', 'NOT_JSON', 'NOT_JSON', 'NOT_JSON', '[]', 0, '2026-01-01', '2026-01-01')
      `).run();

      const id = db.prepare('SELECT id FROM research_memos').get() as { id: number };
      const memoId = asMemoId(String(id.id));

      // 更新 conceptIds 时需要读取 current.paper_ids → safeParseArray 应返回 []
      expect(() => {
        updateMemo(db, memoId, { conceptIds: ['c1'] });
      }).not.toThrow();
    });
  });

  // ─── _meta 损坏 ───

  describe('corrupted _meta values', () => {
    it('dimension check handles non-numeric value gracefully', async () => {
      const { runMigrations } = await import('../../../src/core/database/migration');

      // 篡改 _meta 中的 embedding_dimension 为非数字
      db.prepare("UPDATE _meta SET value = 'not_a_number' WHERE key = 'embedding_dimension'").run();

      const config = createTestConfig();

      // 重新跑 migration 的维度检查——不应 crash
      // NaN 检查会触发 re-seed 而非误报 DimensionMismatchError
      expect(() => {
        runMigrations(db, MIGRATIONS_DIR, config, silentLogger, true);
      }).not.toThrow();
    });

    it('dimension mismatch triggers automatic metadata migration', async () => {
      const { runMigrations } = await import('../../../src/core/database/migration');

      // 设置一个与配置不同的合法维度
      db.prepare("UPDATE _meta SET value = '768' WHERE key = 'embedding_dimension'").run();

      const config = createTestConfig(); // embeddingDimension = 4

      expect(() => {
        runMigrations(db, MIGRATIONS_DIR, config, silentLogger, true);
      }).not.toThrow();

      const row = db
        .prepare("SELECT value FROM _meta WHERE key = 'embedding_dimension'")
        .get() as { value: string };
      expect(row.value).toBe(String(config.rag.embeddingDimension));
    });
  });

  // ─── 事务重试 ───

  describe('transaction retry', () => {
    it('withBusyRetry retries on SQLITE_BUSY and succeeds', async () => {
      const { withBusyRetry } = await import('../../../src/core/database/transaction-utils');

      let attempts = 0;
      const result = withBusyRetry(() => {
        attempts++;
        if (attempts < 3) {
          const err = new Error('SQLITE_BUSY');
          (err as any).code = 'SQLITE_BUSY';
          throw err;
        }
        return 'success';
      }, { maxRetries: 3, initialDelayMs: 1 }); // 极短延迟加速测试

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('withBusyRetry throws after max retries', async () => {
      const { withBusyRetry } = await import('../../../src/core/database/transaction-utils');

      expect(() => {
        withBusyRetry(() => {
          const err = new Error('SQLITE_BUSY');
          (err as any).code = 'SQLITE_BUSY';
          throw err;
        }, { maxRetries: 2, initialDelayMs: 1 });
      }).toThrow('SQLITE_BUSY');
    });
  });

  // ─── 验证器边界 ───

  describe('validator edge cases', () => {
    it('clampConfidence treats non-finite values as 0', async () => {
      const { clampConfidence } = await import('../../../src/core/database/validators');

      // 实现：!Number.isFinite(v) → return 0（NaN、Infinity、-Infinity 都归零）
      expect(clampConfidence(NaN)).toBe(0);
      expect(clampConfidence(Infinity)).toBe(0);
      expect(clampConfidence(-Infinity)).toBe(0);
    });
  });
});
