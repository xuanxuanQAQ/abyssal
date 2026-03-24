/**
 * 集成测试 —— database schema + 真实 SQLite
 *
 * 验证：
 *  - schema.sql 正确建表
 *  - 基本 CRUD 操作
 *  - 外键约束生效
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '@test-utils';

describe('database schema', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  it('should create all expected tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('papers');
    expect(tables).toContain('citations');
    expect(tables).toContain('concepts');
    expect(tables).toContain('paper_concept_map');
    expect(tables).toContain('annotations');
    expect(tables).toContain('chunks');
    expect(tables).toContain('articles');
    expect(tables).toContain('outlines');
    expect(tables).toContain('sections');
    expect(tables).toContain('paper_relations');
  });

  it('should insert and query a paper', () => {
    db.prepare(`
      INSERT INTO papers (id, title, authors, year, paper_type, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('p1', 'Test Paper', JSON.stringify(['Alice']), 2024, 'journal', 'manual');

    const row: any = db.prepare('SELECT * FROM papers WHERE id = ?').get('p1');
    expect(row.title).toBe('Test Paper');
    expect(JSON.parse(row.authors)).toEqual(['Alice']);
  });

  it('should enforce foreign key on citations', () => {
    db.prepare("INSERT INTO papers (id, title) VALUES ('p1', 'Paper 1')").run();

    expect(() => {
      db.prepare("INSERT INTO citations (citing_id, cited_id) VALUES ('p1', 'nonexistent')").run();
    }).toThrow();
  });

  it('should cascade annotation → concept link', () => {
    db.prepare("INSERT INTO papers (id, title) VALUES ('p1', 'Paper')").run();
    db.prepare("INSERT INTO concepts (id, name_en) VALUES ('c1', 'Concept')").run();

    db.prepare(`
      INSERT INTO annotations (paper_id, page, text, type, concept_id)
      VALUES ('p1', 1, 'some text', 'concept_tag', 'c1')
    `).run();

    const ann: any = db.prepare("SELECT * FROM annotations WHERE paper_id = 'p1'").get();
    expect(ann.concept_id).toBe('c1');
    expect(ann.type).toBe('concept_tag');
  });
});
