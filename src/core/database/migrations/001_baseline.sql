-- ═══ Abyssal Baseline Schema v001 ═══
-- 按依赖顺序排列（被引用的表在前）

-- ─── 论文与书目 ───

CREATE TABLE papers (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  authors         TEXT NOT NULL DEFAULT '[]',
  year            INTEGER NOT NULL,
  doi             TEXT,
  arxiv_id        TEXT,
  abstract        TEXT,
  citation_count  INTEGER,
  paper_type      TEXT NOT NULL DEFAULT 'unknown'
                  CHECK(paper_type IN ('journal','conference','book','chapter','preprint','review','unknown')),
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK(source IN ('semantic_scholar','openalex','arxiv','crossref','bibtex','ris','manual')),
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
  fulltext_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK(fulltext_status IN ('pending','acquired','abstract_only','failed')),
  fulltext_path   TEXT,
  text_path       TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'pending'
                  CHECK(analysis_status IN ('pending','analyzed','reviewed','integrated','parse_failed')),
  analysis_path   TEXT,
  relevance       TEXT NOT NULL DEFAULT 'medium'
                  CHECK(relevance IN ('high','medium','low','excluded')),
  decision_note   TEXT,
  failure_reason  TEXT,
  discovered_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_papers_doi ON papers(doi) WHERE doi IS NOT NULL;
CREATE UNIQUE INDEX idx_papers_arxiv ON papers(arxiv_id) WHERE arxiv_id IS NOT NULL;
CREATE INDEX idx_papers_year ON papers(year);
CREATE INDEX idx_papers_fulltext_status ON papers(fulltext_status);
CREATE INDEX idx_papers_analysis_status ON papers(analysis_status);
CREATE INDEX idx_papers_relevance ON papers(relevance);
CREATE INDEX idx_papers_updated ON papers(updated_at);

-- ─── 引用关系 ───

CREATE TABLE citations (
  citing_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  cited_id  TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  PRIMARY KEY (citing_id, cited_id)
);

CREATE INDEX idx_citations_cited ON citations(cited_id);

-- ─── 概念框架 ───

CREATE TABLE concepts (
  id                TEXT PRIMARY KEY,
  name_zh           TEXT NOT NULL,
  name_en           TEXT NOT NULL,
  layer             TEXT NOT NULL,
  definition        TEXT NOT NULL,
  search_keywords   TEXT NOT NULL DEFAULT '[]',
  maturity          TEXT NOT NULL DEFAULT 'tentative'
                    CHECK(maturity IN ('tentative','working','established')),
  parent_id         TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  history           TEXT NOT NULL DEFAULT '[]',
  deprecated        INTEGER NOT NULL DEFAULT 0,
  deprecated_at     TEXT,
  deprecated_reason TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_concepts_maturity ON concepts(maturity);
CREATE INDEX idx_concepts_parent ON concepts(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_concepts_deprecated ON concepts(deprecated);

-- ─── 标注（必须在 paper_concept_map 之前，因后者引用 annotations.id） ───

CREATE TABLE annotations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id      TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL,
  rect_x0       REAL NOT NULL,
  rect_y0       REAL NOT NULL,
  rect_x1       REAL NOT NULL,
  rect_y1       REAL NOT NULL,
  selected_text TEXT NOT NULL,
  type          TEXT NOT NULL
                CHECK(type IN ('highlight','note','concept_tag')),
  color         TEXT NOT NULL DEFAULT '#FFEB3B',
  comment       TEXT,
  concept_id    TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_annotations_paper ON annotations(paper_id);
CREATE INDEX idx_annotations_concept ON annotations(concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX idx_annotations_type ON annotations(type);

-- ─── 论文-概念映射 ───

CREATE TABLE paper_concept_map (
  paper_id      TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  concept_id    TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL
                CHECK(relation IN ('supports','challenges','extends','operationalizes','irrelevant')),
  confidence    REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  evidence      TEXT NOT NULL DEFAULT '{}',
  annotation_id INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
  reviewed      INTEGER NOT NULL DEFAULT 0,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (paper_id, concept_id)
);

CREATE INDEX idx_pcm_paper ON paper_concept_map(paper_id);
CREATE INDEX idx_pcm_concept ON paper_concept_map(concept_id);
CREATE INDEX idx_pcm_reviewed ON paper_concept_map(reviewed);
CREATE INDEX idx_pcm_relation ON paper_concept_map(relation);
CREATE INDEX idx_pcm_created ON paper_concept_map(created_at);

-- ─── 种子论文 ───

CREATE TABLE seeds (
  paper_id  TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  seed_type TEXT NOT NULL
            CHECK(seed_type IN ('axiom','milestone','exploratory')),
  added_at  TEXT NOT NULL
);

-- ─── 检索日志 ───

CREATE TABLE search_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  api_source   TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  executed_at  TEXT NOT NULL
);

CREATE INDEX idx_search_log_time ON search_log(executed_at);

-- ─── 文本块 ───

CREATE TABLE chunks (
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
  source          TEXT NOT NULL
                  CHECK(source IN ('paper','annotation','private','memo','note','figure')),
  position_ratio  REAL,
  parent_chunk_id TEXT,
  chunk_index     INTEGER,
  context_before  TEXT,
  context_after   TEXT
);

CREATE INDEX idx_chunks_paper ON chunks(paper_id) WHERE paper_id IS NOT NULL;
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_chunks_section_type ON chunks(section_type) WHERE section_type IS NOT NULL;
CREATE INDEX idx_chunks_chunk_id ON chunks(chunk_id);

-- ─── 向量虚拟表（维度在运行时替换 {EMBEDDING_DIMENSION} 占位符） ───

CREATE VIRTUAL TABLE chunks_vec USING vec0(
  embedding FLOAT[{EMBEDDING_DIMENSION}]
);

-- ─── 文章 ───

CREATE TABLE articles (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  style           TEXT NOT NULL
                  CHECK(style IN ('academic_blog','formal_paper','technical_doc')),
  csl_style_id    TEXT NOT NULL,
  output_language TEXT NOT NULL DEFAULT 'zh-CN',
  status          TEXT NOT NULL DEFAULT 'drafting'
                  CHECK(status IN ('drafting','reviewing','published')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ─── 纲要 ───

CREATE TABLE outlines (
  id                  TEXT PRIMARY KEY,
  article_id          TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL,
  title               TEXT NOT NULL,
  core_argument       TEXT,
  writing_instruction TEXT,
  concept_ids         TEXT NOT NULL DEFAULT '[]',
  paper_ids           TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','drafted','revised','finalized')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_outlines_article ON outlines(article_id);
CREATE INDEX idx_outlines_sort ON outlines(article_id, sort_order);

-- ─── 节草稿 ───

CREATE TABLE section_drafts (
  outline_entry_id TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  content          TEXT NOT NULL,
  llm_backend      TEXT NOT NULL,
  edited_paragraphs TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  PRIMARY KEY (outline_entry_id, version)
);

-- ─── 多层语义关系网络 ───

CREATE TABLE paper_relations (
  source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  target_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  edge_type       TEXT NOT NULL
                  CHECK(edge_type IN ('semantic_neighbor','concept_agree','concept_conflict',
                                      'concept_extend','article_cites')),
  weight          REAL NOT NULL CHECK(weight >= 0.0 AND weight <= 1.0),
  metadata        TEXT,
  computed_at     TEXT NOT NULL,
  PRIMARY KEY (source_paper_id, target_paper_id, edge_type)
);

CREATE INDEX idx_relations_target ON paper_relations(target_paper_id);
CREATE INDEX idx_relations_type ON paper_relations(edge_type);

-- ─── 概念建议 ───

CREATE TABLE suggested_concepts (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  term                            TEXT NOT NULL,
  term_normalized                 TEXT NOT NULL,
  frequency                       INTEGER NOT NULL DEFAULT 1,
  source_paper_ids                TEXT NOT NULL DEFAULT '[]',
  source_paper_count              INTEGER NOT NULL DEFAULT 1,
  closest_existing_concept_id     TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  closest_existing_concept_similarity TEXT,
  reason                          TEXT,
  status                          TEXT NOT NULL DEFAULT 'pending'
                                  CHECK(status IN ('pending','adopted','dismissed')),
  adopted_concept_id              TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_suggested_term ON suggested_concepts(term_normalized) WHERE status = 'pending';
CREATE INDEX idx_suggested_status ON suggested_concepts(status);
CREATE INDEX idx_suggested_count ON suggested_concepts(source_paper_count DESC);

-- ─── 碎片笔记 ───

CREATE TABLE research_memos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  text            TEXT NOT NULL,
  paper_ids       TEXT NOT NULL DEFAULT '[]',
  concept_ids     TEXT NOT NULL DEFAULT '[]',
  annotation_id   INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
  outline_id      TEXT,
  linked_note_ids TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  indexed         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_memos_created ON research_memos(created_at DESC);
CREATE INDEX idx_memos_indexed ON research_memos(indexed) WHERE indexed = 0;

-- ─── 结构化笔记 ───

CREATE TABLE research_notes (
  id                  TEXT PRIMARY KEY,
  file_path           TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  linked_paper_ids    TEXT NOT NULL DEFAULT '[]',
  linked_concept_ids  TEXT NOT NULL DEFAULT '[]',
  tags                TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_notes_updated ON research_notes(updated_at DESC);

-- ═══ updated_at 自动维护触发器 ═══
-- 将时间戳更新下沉到数据库层，防止 DAO 级联更新遗漏 updated_at。
-- DAO 层仍可显式设置 updated_at，触发器仅在 DAO 未设置时兜底。

CREATE TRIGGER trg_papers_updated_at AFTER UPDATE ON papers
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE papers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_concepts_updated_at AFTER UPDATE ON concepts
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE concepts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_pcm_updated_at AFTER UPDATE ON paper_concept_map
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE paper_concept_map SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE paper_id = NEW.paper_id AND concept_id = NEW.concept_id;
END;

CREATE TRIGGER trg_outlines_updated_at AFTER UPDATE ON outlines
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE outlines SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_articles_updated_at AFTER UPDATE ON articles
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE articles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_suggested_concepts_updated_at AFTER UPDATE ON suggested_concepts
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE suggested_concepts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_memos_updated_at AFTER UPDATE ON research_memos
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE research_memos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_notes_updated_at AFTER UPDATE ON research_notes
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE research_notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

-- ═══ chunks_vec 级联删除触发器 ═══
-- chunks_vec 是虚拟表，不支持 ON DELETE CASCADE。
-- 此触发器确保直接 DELETE FROM chunks / DELETE FROM papers 时
-- 不会留下僵尸向量数据。

CREATE TRIGGER trg_chunks_before_delete BEFORE DELETE ON chunks
FOR EACH ROW
BEGIN
  DELETE FROM chunks_vec WHERE rowid = OLD.rowid;
END;
