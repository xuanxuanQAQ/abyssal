// ═══ 迁移 004: Schema 对齐（关系型 Schema 设计规范 v1.0） ═══
//
// 变更清单：
// 1. papers 表：四步法重建，移除 CHECK 约束 + analysis_status 枚举值迁移
// 2. seeds 表：ADD COLUMN note
// 3. search_log 表：ADD COLUMN params, duration_ms
// 4. chunks 表：ADD COLUMN created_at
// 5. idx_papers_arxiv：UNIQUE → 普通索引
// 6. 其余含 CHECK 的表：四步法重建去除约束

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

/** 幂等 ADD COLUMN——如果列已存在则跳过 */
function safeAddColumn(db: Database.Database, table: string, column: string, type: string): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * analysis_status 值迁移映射。
 * 旧值 → 新值（规范 §1.2）。
 */
const ANALYSIS_STATUS_MAP: Record<string, string> = {
  pending: 'not_started',
  not_started: 'not_started',
  in_progress: 'in_progress',
  analyzed: 'completed',
  completed: 'completed',
  reviewed: 'needs_review',
  needs_review: 'needs_review',
  integrated: 'completed',
  parse_failed: 'failed',
  failed: 'failed',
};

export function migrate(db: Database.Database, _config: AbyssalConfig, skipVecExtension?: boolean): void {
  // 四步法需要临时关闭外键约束
  db.pragma('foreign_keys = OFF');

  try {
    // ────────────────────────────────────────
    // 1. papers 表：四步法重建（移除 CHECK + 迁移 analysis_status）
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE papers_new (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        authors         TEXT NOT NULL DEFAULT '[]',
        year            INTEGER NOT NULL,
        doi             TEXT,
        arxiv_id        TEXT,
        abstract        TEXT,
        citation_count  INTEGER,
        paper_type      TEXT NOT NULL DEFAULT 'unknown',
        source          TEXT NOT NULL DEFAULT 'manual',
        venue           TEXT,
        journal         TEXT,
        volume          TEXT,
        issue           TEXT,
        pages           TEXT,
        publisher       TEXT,
        isbn            TEXT,
        edition         TEXT,
        editors         TEXT,
        book_title      TEXT,
        series          TEXT,
        issn            TEXT,
        pmid            TEXT,
        pmcid           TEXT,
        url             TEXT,
        bibtex_key      TEXT,
        biblio_complete INTEGER NOT NULL DEFAULT 0,
        fulltext_status TEXT NOT NULL DEFAULT 'not_attempted',
        fulltext_path   TEXT,
        text_path       TEXT,
        analysis_status TEXT NOT NULL DEFAULT 'not_started',
        analysis_path   TEXT,
        relevance       TEXT NOT NULL DEFAULT 'medium',
        decision_note   TEXT,
        failure_reason  TEXT,
        discovered_at   TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `);

    // 复制数据并转换 analysis_status 值
    db.exec(`
      INSERT INTO papers_new SELECT
        id, title, authors, year, doi, arxiv_id, abstract,
        citation_count, paper_type, source, venue, journal, volume,
        issue, pages, publisher, isbn, edition, editors, book_title,
        series, issn, pmid, pmcid, url, bibtex_key, biblio_complete,
        fulltext_status, fulltext_path, text_path,
        CASE analysis_status
          WHEN 'analyzed' THEN 'completed'
          WHEN 'reviewed' THEN 'completed'
          WHEN 'integrated' THEN 'completed'
          WHEN 'parse_failed' THEN 'failed'
          ELSE analysis_status
        END,
        analysis_path, relevance, decision_note, failure_reason,
        discovered_at, updated_at
      FROM papers
    `);

    db.exec('DROP TABLE papers');
    db.exec('ALTER TABLE papers_new RENAME TO papers');

    // 重建索引（idx_papers_arxiv 改为普通索引，非 UNIQUE）
    db.exec(`
      CREATE UNIQUE INDEX idx_papers_doi ON papers(doi) WHERE doi IS NOT NULL;
      CREATE INDEX idx_papers_arxiv ON papers(arxiv_id) WHERE arxiv_id IS NOT NULL;
      CREATE INDEX idx_papers_fulltext_status ON papers(fulltext_status);
      CREATE INDEX idx_papers_analysis_status ON papers(analysis_status);
      CREATE INDEX idx_papers_relevance ON papers(relevance);
      CREATE INDEX idx_papers_year ON papers(year);
      CREATE INDEX idx_papers_updated ON papers(updated_at);
    `);

    // 重建 updated_at 触发器
    db.exec(`
      CREATE TRIGGER trg_papers_updated_at AFTER UPDATE ON papers
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE papers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END
    `);

    // ────────────────────────────────────────
    // 2. concepts 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE concepts_new (
        id                TEXT PRIMARY KEY,
        name_zh           TEXT NOT NULL,
        name_en           TEXT NOT NULL,
        layer             TEXT NOT NULL,
        definition        TEXT NOT NULL,
        search_keywords   TEXT NOT NULL DEFAULT '[]',
        maturity          TEXT NOT NULL DEFAULT 'tentative',
        parent_id         TEXT REFERENCES concepts_new(id) ON DELETE SET NULL,
        history           TEXT NOT NULL DEFAULT '[]',
        deprecated        INTEGER NOT NULL DEFAULT 0,
        deprecated_at     TEXT,
        deprecated_reason TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      )
    `);

    db.exec('INSERT INTO concepts_new SELECT * FROM concepts');
    db.exec('DROP TABLE concepts');
    db.exec('ALTER TABLE concepts_new RENAME TO concepts');

    db.exec(`
      CREATE INDEX idx_concepts_maturity ON concepts(maturity);
      CREATE INDEX idx_concepts_parent ON concepts(parent_id) WHERE parent_id IS NOT NULL;
      CREATE INDEX idx_concepts_deprecated ON concepts(deprecated);
    `);

    db.exec(`
      CREATE TRIGGER trg_concepts_updated_at AFTER UPDATE ON concepts
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE concepts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END
    `);

    // ────────────────────────────────────────
    // 3. annotations 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE annotations_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id      TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        page          INTEGER NOT NULL,
        rect_x0       REAL NOT NULL,
        rect_y0       REAL NOT NULL,
        rect_x1       REAL NOT NULL,
        rect_y1       REAL NOT NULL,
        selected_text TEXT NOT NULL,
        type          TEXT NOT NULL,
        color         TEXT NOT NULL DEFAULT '#FFEB3B',
        comment       TEXT,
        concept_id    TEXT REFERENCES concepts(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL
      )
    `);

    db.exec('INSERT INTO annotations_new SELECT * FROM annotations');
    db.exec('DROP TABLE annotations');
    db.exec('ALTER TABLE annotations_new RENAME TO annotations');

    db.exec(`
      CREATE INDEX idx_annotations_paper ON annotations(paper_id);
      CREATE INDEX idx_annotations_concept ON annotations(concept_id) WHERE concept_id IS NOT NULL;
      CREATE INDEX idx_annotations_type ON annotations(type);
    `);

    // ────────────────────────────────────────
    // 4. paper_concept_map 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE paper_concept_map_new (
        paper_id      TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        concept_id    TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
        relation      TEXT NOT NULL,
        confidence    REAL NOT NULL,
        evidence      TEXT NOT NULL DEFAULT '{}',
        annotation_id INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
        reviewed      INTEGER NOT NULL DEFAULT 0,
        reviewed_at   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (paper_id, concept_id)
      )
    `);

    db.exec('INSERT INTO paper_concept_map_new SELECT * FROM paper_concept_map');
    db.exec('DROP TABLE paper_concept_map');
    db.exec('ALTER TABLE paper_concept_map_new RENAME TO paper_concept_map');

    db.exec(`
      CREATE INDEX idx_pcm_concept ON paper_concept_map(concept_id);
      CREATE INDEX idx_pcm_reviewed ON paper_concept_map(reviewed);
      CREATE INDEX idx_pcm_relation ON paper_concept_map(relation);
      CREATE INDEX idx_pcm_created ON paper_concept_map(created_at);
    `);

    db.exec(`
      CREATE TRIGGER trg_pcm_updated_at AFTER UPDATE ON paper_concept_map
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE paper_concept_map SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE paper_id = NEW.paper_id AND concept_id = NEW.concept_id;
      END
    `);

    // ────────────────────────────────────────
    // 5. chunks 表：四步法去除 CHECK + 新增 created_at 列
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE chunks_new (
        rowid           INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id        TEXT NOT NULL UNIQUE,
        paper_id        TEXT REFERENCES papers(id) ON DELETE CASCADE,
        section_label   TEXT,
        section_title   TEXT,
        section_type    TEXT,
        page_start      INTEGER,
        page_end        INTEGER,
        text            TEXT NOT NULL,
        token_count     INTEGER NOT NULL,
        source          TEXT NOT NULL DEFAULT 'paper',
        position_ratio  REAL,
        parent_chunk_id TEXT,
        chunk_index     INTEGER,
        context_before  TEXT,
        context_after   TEXT,
        created_at      TEXT
      )
    `);

    // 复制数据，created_at 设为 NULL（旧数据无此字段）
    db.exec(`
      INSERT INTO chunks_new (
        rowid, chunk_id, paper_id, section_label, section_title, section_type,
        page_start, page_end, text, token_count, source,
        position_ratio, parent_chunk_id, chunk_index,
        context_before, context_after, created_at
      )
      SELECT
        rowid, chunk_id, paper_id, section_label, section_title, section_type,
        page_start, page_end, text, token_count, source,
        position_ratio, parent_chunk_id, chunk_index,
        context_before, context_after, NULL
      FROM chunks
    `);

    db.exec('DROP TABLE chunks');
    db.exec('ALTER TABLE chunks_new RENAME TO chunks');

    db.exec(`
      CREATE UNIQUE INDEX idx_chunks_chunk_id ON chunks(chunk_id);
      CREATE INDEX idx_chunks_paper ON chunks(paper_id) WHERE paper_id IS NOT NULL;
      CREATE INDEX idx_chunks_source ON chunks(source);
      CREATE INDEX idx_chunks_section_type ON chunks(section_type) WHERE section_type IS NOT NULL;
    `);

    // 重建 chunks_vec 级联删除触发器（skipVecExtension 时跳过——chunks_vec 不存在）
    if (!skipVecExtension) {
      db.exec(`
        CREATE TRIGGER trg_chunks_before_delete BEFORE DELETE ON chunks
        FOR EACH ROW
        BEGIN
          DELETE FROM chunks_vec WHERE rowid = OLD.rowid;
        END
      `);
    }

    // 重建 FTS5 同步触发器（如果 chunks_fts 存在）
    const ftsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
    ).get();

    if (ftsExists) {
      db.exec(`
        CREATE TRIGGER trg_chunks_fts_insert AFTER INSERT ON chunks
        BEGIN
          INSERT INTO chunks_fts(rowid, chunk_id, text) VALUES (NEW.rowid, NEW.chunk_id, NEW.text);
        END;

        CREATE TRIGGER trg_chunks_fts_delete BEFORE DELETE ON chunks
        BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, text) VALUES ('delete', OLD.rowid, OLD.chunk_id, OLD.text);
        END;

        CREATE TRIGGER trg_chunks_fts_update AFTER UPDATE OF text ON chunks
        BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, chunk_id, text) VALUES ('delete', OLD.rowid, OLD.chunk_id, OLD.text);
          INSERT INTO chunks_fts(rowid, chunk_id, text) VALUES (NEW.rowid, NEW.chunk_id, NEW.text);
        END;
      `);
    }

    // ────────────────────────────────────────
    // 6. articles 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE articles_new (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        style           TEXT NOT NULL DEFAULT 'academic_blog',
        csl_style_id    TEXT NOT NULL,
        output_language TEXT NOT NULL DEFAULT 'zh-CN',
        status          TEXT NOT NULL DEFAULT 'drafting',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )
    `);

    db.exec('INSERT INTO articles_new SELECT * FROM articles');
    db.exec('DROP TABLE articles');
    db.exec('ALTER TABLE articles_new RENAME TO articles');

    db.exec(`
      CREATE TRIGGER trg_articles_updated_at AFTER UPDATE ON articles
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE articles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END
    `);

    // ────────────────────────────────────────
    // 7. outlines 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE outlines_new (
        id                  TEXT PRIMARY KEY,
        article_id          TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        sort_order          INTEGER NOT NULL,
        title               TEXT NOT NULL,
        core_argument       TEXT,
        writing_instruction TEXT,
        concept_ids         TEXT NOT NULL DEFAULT '[]',
        paper_ids           TEXT NOT NULL DEFAULT '[]',
        status              TEXT NOT NULL DEFAULT 'pending',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      )
    `);

    db.exec('INSERT INTO outlines_new SELECT * FROM outlines');
    db.exec('DROP TABLE outlines');
    db.exec('ALTER TABLE outlines_new RENAME TO outlines');

    db.exec(`
      CREATE INDEX idx_outlines_article ON outlines(article_id);
      CREATE INDEX idx_outlines_sort ON outlines(article_id, sort_order);
    `);

    db.exec(`
      CREATE TRIGGER trg_outlines_updated_at AFTER UPDATE ON outlines
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE outlines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END
    `);

    // ────────────────────────────────────────
    // 8. paper_relations 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE paper_relations_new (
        source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        target_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        edge_type       TEXT NOT NULL,
        weight          REAL NOT NULL,
        metadata        TEXT,
        computed_at     TEXT NOT NULL,
        PRIMARY KEY (source_paper_id, target_paper_id, edge_type)
      )
    `);

    db.exec('INSERT INTO paper_relations_new SELECT * FROM paper_relations');
    db.exec('DROP TABLE paper_relations');
    db.exec('ALTER TABLE paper_relations_new RENAME TO paper_relations');

    db.exec(`
      CREATE INDEX idx_relations_target ON paper_relations(target_paper_id);
      CREATE INDEX idx_relations_type ON paper_relations(edge_type);
    `);

    // ────────────────────────────────────────
    // 9. suggested_concepts 表：四步法去除 CHECK
    // ────────────────────────────────────────

    db.exec(`
      CREATE TABLE suggested_concepts_new (
        id                              INTEGER PRIMARY KEY AUTOINCREMENT,
        term                            TEXT NOT NULL,
        term_normalized                 TEXT NOT NULL,
        frequency                       INTEGER NOT NULL DEFAULT 1,
        source_paper_ids                TEXT NOT NULL DEFAULT '[]',
        source_paper_count              INTEGER NOT NULL DEFAULT 1,
        closest_existing_concept_id     TEXT REFERENCES concepts(id) ON DELETE SET NULL,
        closest_existing_concept_similarity TEXT,
        reason                          TEXT,
        suggested_definition            TEXT,
        suggested_keywords              TEXT NOT NULL DEFAULT '[]',
        status                          TEXT NOT NULL DEFAULT 'pending',
        adopted_concept_id              TEXT REFERENCES concepts(id) ON DELETE SET NULL,
        created_at                      TEXT NOT NULL,
        updated_at                      TEXT NOT NULL
      )
    `);

    db.exec('INSERT INTO suggested_concepts_new SELECT * FROM suggested_concepts');
    db.exec('DROP TABLE suggested_concepts');
    db.exec('ALTER TABLE suggested_concepts_new RENAME TO suggested_concepts');

    db.exec(`
      CREATE UNIQUE INDEX idx_suggested_term ON suggested_concepts(term_normalized) WHERE status = 'pending';
      CREATE INDEX idx_suggested_status ON suggested_concepts(status);
      CREATE INDEX idx_suggested_count ON suggested_concepts(source_paper_count DESC);
    `);

    db.exec(`
      CREATE TRIGGER trg_suggested_concepts_updated_at AFTER UPDATE ON suggested_concepts
      FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE suggested_concepts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;
      END
    `);

    // ────────────────────────────────────────
    // 10. seeds 表：ADD COLUMN note
    // ────────────────────────────────────────

    safeAddColumn(db, 'seeds', 'note', 'TEXT');

    // ────────────────────────────────────────
    // 11. search_log 表：ADD COLUMN params, duration_ms
    // ────────────────────────────────────────

    safeAddColumn(db, 'search_log', 'params', 'TEXT');
    safeAddColumn(db, 'search_log', 'duration_ms', 'INTEGER');

    // ────────────────────────────────────────
    // 外键完整性验证
    // ────────────────────────────────────────

    const fkCheck = db.pragma('foreign_key_check') as unknown[];
    if (fkCheck.length > 0) {
      throw new Error(
        `Foreign key integrity check failed after migration: ${JSON.stringify(fkCheck.slice(0, 5))}`,
      );
    }
  } finally {
    // 恢复外键约束
    db.pragma('foreign_keys = ON');
  }
}
