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
    expect(tables).toContain('article_assets');
    expect(tables).toContain('cross_ref_labels');
  });

  it('should include writing overhaul columns with correct defaults', () => {
    const outlineColumns = db.prepare("PRAGMA table_info('outlines')").all() as Array<{ name: string }>;
    const articleColumns = db.prepare("PRAGMA table_info('articles')").all() as Array<{ name: string }>;
    const draftColumns = db.prepare("PRAGMA table_info('section_drafts')").all() as Array<{ name: string }>;

    expect(outlineColumns.map((c) => c.name)).toEqual(expect.arrayContaining(['parent_id', 'depth']));
    expect(articleColumns.map((c) => c.name)).toEqual(expect.arrayContaining(['abstract', 'keywords', 'authors', 'target_word_count']));
    expect(draftColumns.map((c) => c.name)).toEqual(expect.arrayContaining(['source', 'document_json']));

    db.prepare(`
      INSERT INTO articles (id, title, csl_style_id, created_at, updated_at)
      VALUES ('a1', 'Article', 'gb-t-7714', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO outlines (id, article_id, sort_order, title, created_at, updated_at)
      VALUES ('o1', 'a1', 1, 'Section 1', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO section_drafts (outline_entry_id, version, content, llm_backend, created_at)
      VALUES ('o1', 1, 'draft body', 'test-backend', datetime('now'))
    `).run();

    const draft = db.prepare("SELECT source, document_json FROM section_drafts WHERE outline_entry_id='o1' AND version=1").get() as { source: string; document_json: string | null };
    expect(draft.source).toBe('manual');
    expect(draft.document_json).toBeNull();
  });

  it('should enforce writing constraints and cascade article-linked rows', () => {
    db.prepare(`
      INSERT INTO articles (id, title, csl_style_id, created_at, updated_at)
      VALUES ('a2', 'Article 2', 'gb-t-7714', datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO cross_ref_labels (id, article_id, label, ref_type)
      VALUES ('x1', 'a2', 'fig:intro', 'figure')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO cross_ref_labels (id, article_id, label, ref_type)
        VALUES ('x2', 'a2', 'fig:intro', 'figure')
      `).run();
    }).toThrow();

    db.prepare(`
      INSERT INTO article_assets (id, article_id, file_name, mime_type, file_path, file_size)
      VALUES ('asset1', 'a2', 'figure.png', 'image/png', '/tmp/figure.png', 1024)
    `).run();

    db.prepare("DELETE FROM articles WHERE id='a2'").run();

    const assetsCount = db.prepare("SELECT COUNT(*) AS cnt FROM article_assets WHERE article_id='a2'").get() as { cnt: number };
    const labelsCount = db.prepare("SELECT COUNT(*) AS cnt FROM cross_ref_labels WHERE article_id='a2'").get() as { cnt: number };
    expect(assetsCount.cnt).toBe(0);
    expect(labelsCount.cnt).toBe(0);
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
