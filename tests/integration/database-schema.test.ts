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
    expect(tables).toContain('section_drafts');
    expect(tables).toContain('paper_relations');
  });

  it('should insert and query a paper', () => {
    db.prepare(`
      INSERT INTO papers (id, title, authors, year, paper_type, source, discovered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('p1', 'Test Paper', JSON.stringify(['Alice']), 2024, 'journal', 'manual');

    const row: any = db.prepare('SELECT * FROM papers WHERE id = ?').get('p1');
    expect(row.title).toBe('Test Paper');
    expect(JSON.parse(row.authors)).toEqual(['Alice']);
  });

  it('should enforce foreign key on citations', () => {
    db.prepare("INSERT INTO papers (id, title, authors, year, paper_type, source, discovered_at, updated_at) VALUES ('p1', 'Paper 1', '[]', 2024, 'journal', 'manual', datetime('now'), datetime('now'))").run();

    expect(() => {
      db.prepare("INSERT INTO citations (citing_id, cited_id) VALUES ('p1', 'nonexistent')").run();
    }).toThrow();
  });

  it('should cascade annotation → concept link', () => {
    db.prepare("INSERT INTO papers (id, title, authors, year, paper_type, source, discovered_at, updated_at) VALUES ('p1', 'Paper', '[]', 2024, 'journal', 'manual', datetime('now'), datetime('now'))").run();
    db.prepare("INSERT INTO concepts (id, name_zh, name_en, layer, definition, search_keywords, maturity, history, created_at, updated_at) VALUES ('c1', '概念', 'Concept', 'core', 'def', '[]', 'tentative', '[]', datetime('now'), datetime('now'))").run();

    db.prepare(`
      INSERT INTO annotations (paper_id, page, rect_x0, rect_y0, rect_x1, rect_y1, selected_text, type, concept_id, created_at)
      VALUES ('p1', 1, 0, 0, 10, 10, 'some text', 'conceptTag', 'c1', datetime('now'))
    `).run();

    const ann: any = db.prepare("SELECT * FROM annotations WHERE paper_id = 'p1'").get();
    expect(ann.concept_id).toBe('c1');
    expect(ann.type).toBe('conceptTag');
  });
});
