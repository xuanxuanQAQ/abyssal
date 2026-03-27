/**
 * 005_memo_maps — 规范化碎片笔记多对多关系
 *
 * 问题：research_memos.paper_ids / concept_ids / linked_note_ids 存储为 JSON 数组，
 *       getMemosByEntity 通过 json_each() 全表扫描查询，O(N) 不可索引。
 *
 * 方案：新建 memo_paper_map / memo_concept_map / memo_note_map 映射表，
 *       从现有 JSON 数组迁移数据，查询走索引 O(log N)。
 *       保留原 JSON 列作为冗余（向后兼容），后续版本可移除。
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  // ── 建表 ──

  db.exec(`
    CREATE TABLE IF NOT EXISTS memo_paper_map (
      memo_id   INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
      paper_id  TEXT    NOT NULL,
      PRIMARY KEY (memo_id, paper_id)
    );

    CREATE TABLE IF NOT EXISTS memo_concept_map (
      memo_id    INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
      concept_id TEXT    NOT NULL,
      PRIMARY KEY (memo_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS memo_note_map (
      memo_id INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
      note_id TEXT    NOT NULL,
      PRIMARY KEY (memo_id, note_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memo_paper_map_paper   ON memo_paper_map(paper_id);
    CREATE INDEX IF NOT EXISTS idx_memo_concept_map_concept ON memo_concept_map(concept_id);
    CREATE INDEX IF NOT EXISTS idx_memo_note_map_note     ON memo_note_map(note_id);
  `);

  // ── 从 JSON 列迁移数据 ──

  const memos = db.prepare(
    'SELECT id, paper_ids, concept_ids, linked_note_ids FROM research_memos',
  ).all() as Array<{ id: number; paper_ids: string; concept_ids: string; linked_note_ids: string }>;

  const insertPaper = db.prepare(
    'INSERT OR IGNORE INTO memo_paper_map (memo_id, paper_id) VALUES (?, ?)',
  );
  const insertConcept = db.prepare(
    'INSERT OR IGNORE INTO memo_concept_map (memo_id, concept_id) VALUES (?, ?)',
  );
  const insertNote = db.prepare(
    'INSERT OR IGNORE INTO memo_note_map (memo_id, note_id) VALUES (?, ?)',
  );

  for (const memo of memos) {
    for (const pid of JSON.parse(memo.paper_ids) as string[]) {
      insertPaper.run(memo.id, pid);
    }
    for (const cid of JSON.parse(memo.concept_ids) as string[]) {
      insertConcept.run(memo.id, cid);
    }
    for (const nid of JSON.parse(memo.linked_note_ids) as string[]) {
      insertNote.run(memo.id, nid);
    }
  }
}
