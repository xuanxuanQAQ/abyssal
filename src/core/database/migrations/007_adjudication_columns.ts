/**
 * 007_adjudication_columns — paper_concept_map 裁决字段补全
 *
 * 1. 添加 decision_status 列（accepted/revised/rejected/excluded）
 * 2. 添加 decision_note 列（裁决理由）
 * 3. 为 decision_status 创建索引
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  const cols = db.prepare(`PRAGMA table_info(paper_concept_map)`).all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has('decision_status')) {
    db.exec(`ALTER TABLE paper_concept_map ADD COLUMN decision_status TEXT DEFAULT NULL`);
  }
  if (!colNames.has('decision_note')) {
    db.exec(`ALTER TABLE paper_concept_map ADD COLUMN decision_note TEXT DEFAULT NULL`);
  }

  // 索引：按 decision_status 筛选未裁决/已拒绝等
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pcm_decision_status ON paper_concept_map(decision_status)`);
}
