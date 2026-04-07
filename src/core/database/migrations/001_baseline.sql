-- ═══ Abyssal Baseline Schema v001 (Squashed) ═══
-- 合并全部迁移 001–023 的最终状态
-- 按依赖顺序排列（被引用的表在前）
-- 规范：不使用 CHECK 约束，全部枚举校验在 DAO 层执行

-- ─── 元信息 ───

CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── 论文与书目 ───

CREATE TABLE papers (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  authors                TEXT NOT NULL DEFAULT '[]',
  year                   INTEGER NOT NULL,
  doi                    TEXT,
  arxiv_id               TEXT,
  abstract               TEXT,
  citation_count         INTEGER,
  paper_type             TEXT NOT NULL DEFAULT 'unknown',
  source                 TEXT NOT NULL DEFAULT 'manual',
  venue                  TEXT,
  journal                TEXT,
  volume                 TEXT,
  issue                  TEXT,
  pages                  TEXT,
  publisher              TEXT,
  isbn                   TEXT,
  edition                TEXT,
  editors                TEXT,
  book_title             TEXT,
  series                 TEXT,
  issn                   TEXT,
  pmid                   TEXT,
  pmcid                  TEXT,
  url                    TEXT,
  bibtex_key             TEXT,
  biblio_complete        INTEGER NOT NULL DEFAULT 0,
  fulltext_status        TEXT NOT NULL DEFAULT 'not_attempted',
  fulltext_path          TEXT,
  fulltext_source        TEXT,
  text_path              TEXT,
  analysis_status        TEXT NOT NULL DEFAULT 'not_started',
  analysis_path          TEXT,
  relevance              TEXT NOT NULL DEFAULT 'medium',
  decision_note          TEXT,
  failure_reason         TEXT,
  failure_count          INTEGER NOT NULL DEFAULT 0,
  identifiers_resolved_via TEXT,
  source_url             TEXT,
  discovered_at          TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_papers_doi ON papers(doi) WHERE doi IS NOT NULL;
CREATE INDEX idx_papers_arxiv ON papers(arxiv_id) WHERE arxiv_id IS NOT NULL;
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
  maturity          TEXT NOT NULL DEFAULT 'tentative',
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

-- ─── 标注 ───

CREATE TABLE annotations (
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
);

CREATE INDEX idx_annotations_paper ON annotations(paper_id);
CREATE INDEX idx_annotations_concept ON annotations(concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX idx_annotations_type ON annotations(type);

-- ─── 论文-概念映射 ───

CREATE TABLE paper_concept_map (
  paper_id            TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  concept_id          TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  relation            TEXT NOT NULL,
  confidence          REAL NOT NULL,
  evidence            TEXT NOT NULL DEFAULT '{}',
  annotation_id       INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
  reviewed            INTEGER NOT NULL DEFAULT 0,
  reviewed_at         TEXT,
  decision_status     TEXT DEFAULT NULL,
  decision_note       TEXT DEFAULT NULL,
  evidence_bbox       TEXT,
  evidence_block_type TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (paper_id, concept_id)
);

CREATE INDEX idx_pcm_concept ON paper_concept_map(concept_id);
CREATE INDEX idx_pcm_reviewed ON paper_concept_map(reviewed);
CREATE INDEX idx_pcm_relation ON paper_concept_map(relation);
CREATE INDEX idx_pcm_created ON paper_concept_map(created_at);
CREATE INDEX idx_pcm_decision_status ON paper_concept_map(decision_status);

-- ─── 种子论文 ───

CREATE TABLE seeds (
  paper_id  TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  seed_type TEXT NOT NULL,
  note      TEXT,
  added_at  TEXT NOT NULL
);

-- ─── 检索日志 ───

CREATE TABLE search_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  query        TEXT NOT NULL,
  api_source   TEXT NOT NULL,
  params       TEXT,
  result_count INTEGER NOT NULL,
  duration_ms  INTEGER,
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
  source          TEXT NOT NULL DEFAULT 'paper',
  position_ratio  REAL,
  parent_chunk_id TEXT,
  chunk_index     INTEGER,
  context_before  TEXT,
  context_after   TEXT,
  block_type      TEXT,
  reading_order   INTEGER,
  column_layout   TEXT,
  created_at      TEXT
);

CREATE INDEX idx_chunks_paper ON chunks(paper_id) WHERE paper_id IS NOT NULL;
CREATE INDEX idx_chunks_source ON chunks(source);
CREATE INDEX idx_chunks_section_type ON chunks(section_type) WHERE section_type IS NOT NULL;
CREATE UNIQUE INDEX idx_chunks_chunk_id ON chunks(chunk_id);

-- ─── 向量虚拟表（维度在运行时替换 {EMBEDDING_DIMENSION} 占位符） ───

CREATE VIRTUAL TABLE chunks_vec USING vec0(
  embedding FLOAT[{EMBEDDING_DIMENSION}]
);

-- ─── FTS5 全文搜索 ───

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  content='chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- ─── 文章 ───
-- 注意：default_draft_id 在文件末尾通过 ALTER TABLE 添加（循环引用 article_drafts）

CREATE TABLE articles (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  style           TEXT NOT NULL DEFAULT 'academic_blog',
  csl_style_id    TEXT NOT NULL,
  output_language TEXT NOT NULL DEFAULT 'zh-CN',
  status          TEXT NOT NULL DEFAULT 'drafting',
  abstract        TEXT,
  keywords        TEXT NOT NULL DEFAULT '[]',
  authors         TEXT NOT NULL DEFAULT '[]',
  target_word_count INTEGER,
  document_json   TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
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
  status              TEXT NOT NULL DEFAULT 'pending',
  parent_id           TEXT REFERENCES outlines(id) ON DELETE SET NULL,
  depth               INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_outlines_article ON outlines(article_id);
CREATE INDEX idx_outlines_sort ON outlines(article_id, sort_order);
CREATE INDEX idx_outlines_parent ON outlines(parent_id);

-- ─── 节草稿 ───

CREATE TABLE section_drafts (
  outline_entry_id  TEXT NOT NULL REFERENCES outlines(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  content           TEXT NOT NULL,
  llm_backend       TEXT NOT NULL,
  edited_paragraphs TEXT NOT NULL DEFAULT '[]',
  source            TEXT NOT NULL DEFAULT 'manual',
  document_json     TEXT,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (outline_entry_id, version)
);

-- ─── 多层语义关系网络 ───

CREATE TABLE paper_relations (
  source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  target_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  edge_type       TEXT NOT NULL,
  weight          REAL NOT NULL,
  metadata        TEXT,
  computed_at     TEXT NOT NULL,
  stale           INTEGER NOT NULL DEFAULT 0,
  stale_since     TEXT,
  PRIMARY KEY (source_paper_id, target_paper_id, edge_type)
);

CREATE INDEX idx_relations_target ON paper_relations(target_paper_id);
CREATE INDEX idx_relations_type ON paper_relations(edge_type);
CREATE INDEX idx_relations_stale ON paper_relations(stale) WHERE stale = 1;

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
  suggested_definition            TEXT,
  suggested_keywords              TEXT NOT NULL DEFAULT '[]',
  status                          TEXT NOT NULL DEFAULT 'pending',
  adopted_concept_id              TEXT REFERENCES concepts(id) ON DELETE SET NULL,
  dismiss_reason                  TEXT,
  adopted_maturity                TEXT,
  created_at                      TEXT NOT NULL,
  updated_at                      TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_suggested_term ON suggested_concepts(term_normalized) WHERE status = 'pending';
CREATE INDEX idx_suggested_status ON suggested_concepts(status);
CREATE INDEX idx_suggested_count ON suggested_concepts(source_paper_count DESC);

-- ─── 论文基底分析（级联提纯阶段一产物，概念无关） ───

CREATE TABLE paper_analysis_base (
  paper_id              TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  claims                TEXT NOT NULL DEFAULT '[]',
  method_tags           TEXT NOT NULL DEFAULT '[]',
  key_terms             TEXT NOT NULL DEFAULT '[]',
  contribution_summary  TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- ─── 关键词候选（Human-in-the-loop，待用户确认） ───

CREATE TABLE keyword_candidates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id      TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  term            TEXT NOT NULL,
  source_count    INTEGER NOT NULL DEFAULT 1,
  source_paper_ids TEXT NOT NULL DEFAULT '[]',
  confidence      REAL NOT NULL DEFAULT 0.5,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_keyword_candidates_concept ON keyword_candidates(concept_id);
CREATE UNIQUE INDEX idx_keyword_candidates_unique ON keyword_candidates(concept_id, term) WHERE status = 'pending';

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

-- ─── Memo 多对多映射表 ───

CREATE TABLE memo_paper_map (
  memo_id   INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
  paper_id  TEXT    NOT NULL,
  PRIMARY KEY (memo_id, paper_id)
);
CREATE INDEX idx_memo_paper_map_paper ON memo_paper_map(paper_id);

CREATE TABLE memo_concept_map (
  memo_id    INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
  concept_id TEXT    NOT NULL,
  PRIMARY KEY (memo_id, concept_id)
);
CREATE INDEX idx_memo_concept_map_concept ON memo_concept_map(concept_id);

CREATE TABLE memo_note_map (
  memo_id INTEGER NOT NULL REFERENCES research_memos(id) ON DELETE CASCADE,
  note_id TEXT    NOT NULL,
  PRIMARY KEY (memo_id, note_id)
);
CREATE INDEX idx_memo_note_map_note ON memo_note_map(note_id);

-- ─── 结构化笔记 ───

CREATE TABLE research_notes (
  id                  TEXT PRIMARY KEY,
  file_path           TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  linked_paper_ids    TEXT NOT NULL DEFAULT '[]',
  linked_concept_ids  TEXT NOT NULL DEFAULT '[]',
  tags                TEXT NOT NULL DEFAULT '[]',
  document_json       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_notes_updated ON research_notes(updated_at DESC);

-- ─── Acquire 失败日志 ───

CREATE TABLE acquire_failure_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id      TEXT NOT NULL,
  source        TEXT NOT NULL,
  failure_type  TEXT NOT NULL,
  publisher     TEXT,
  doi_prefix    TEXT,
  http_status   INTEGER,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_afl_source ON acquire_failure_log(source);
CREATE INDEX idx_afl_doi_prefix ON acquire_failure_log(doi_prefix) WHERE doi_prefix IS NOT NULL;
CREATE INDEX idx_afl_failure_type ON acquire_failure_log(failure_type);
CREATE INDEX idx_afl_created_at ON acquire_failure_log(created_at);

-- ─── Workflow Checkpoints ───

CREATE TABLE workflow_checkpoints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL,
  paper_id      TEXT,
  step_index    INTEGER NOT NULL DEFAULT 0,
  step_name     TEXT NOT NULL,
  state_json    TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'in_progress',
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL
);

CREATE INDEX idx_wfc_paper_id ON workflow_checkpoints(paper_id);
CREATE INDEX idx_wfc_status ON workflow_checkpoints(status);

-- ─── LLM 审计日志 ───

CREATE TABLE llm_audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT,
  model         TEXT NOT NULL,
  provider      TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL DEFAULT NULL,
  paper_id      TEXT DEFAULT NULL,
  finish_reason TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_lla_workflow_id ON llm_audit_log(workflow_id);
CREATE INDEX idx_lla_created_at ON llm_audit_log(created_at);
CREATE INDEX idx_lla_model ON llm_audit_log(model);

-- ─── Discover 搜索历史 ───

CREATE TABLE discover_runs (
  id           TEXT PRIMARY KEY,
  query        TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_dr_created_at ON discover_runs(created_at);

-- ─── 提取的参考文献 ───

CREATE TABLE extracted_references (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id          TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  order_index       INTEGER NOT NULL,
  raw_text          TEXT NOT NULL,
  doi               TEXT,
  year              INTEGER,
  rough_authors     TEXT,
  rough_title       TEXT,
  resolved_paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_extracted_references_paper ON extracted_references(paper_id);
CREATE INDEX idx_extracted_references_doi ON extracted_references(doi) WHERE doi IS NOT NULL;
CREATE INDEX idx_extracted_references_resolved ON extracted_references(resolved_paper_id) WHERE resolved_paper_id IS NOT NULL;

-- ─── Hydrate 审计日志 ───

CREATE TABLE hydrate_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id    TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  field_value TEXT,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_hydrate_log_paper ON hydrate_log(paper_id);

-- ─── 文章资源 ───

CREATE TABLE article_assets (
  id         TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  file_name  TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  file_size  INTEGER NOT NULL,
  caption    TEXT,
  alt_text   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_article_assets_article ON article_assets(article_id);

-- ─── 交叉引用标签 ───

CREATE TABLE cross_ref_labels (
  id             TEXT PRIMARY KEY,
  article_id     TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  ref_type       TEXT NOT NULL,
  section_id     TEXT,
  display_number TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(article_id, label)
);

CREATE INDEX idx_cross_ref_labels_article ON cross_ref_labels(article_id);

-- ─── 聊天会话 ───

CREATE TABLE chat_sessions (
  context_source_key TEXT PRIMARY KEY,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE chat_messages (
  id                 TEXT PRIMARY KEY,
  context_source_key TEXT NOT NULL REFERENCES chat_sessions(context_source_key) ON DELETE CASCADE,
  role               TEXT NOT NULL,
  content            TEXT NOT NULL,
  timestamp          INTEGER NOT NULL,
  tool_calls         TEXT,
  citations          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_messages_session_ts ON chat_messages(context_source_key, timestamp DESC);

-- ─── Recon 缓存 ───

CREATE TABLE recon_cache (
  doi                TEXT PRIMARY KEY,
  publisher_domain   TEXT,
  resolved_url       TEXT,
  oa_status          TEXT,
  pdf_urls           TEXT NOT NULL DEFAULT '[]',
  repository_urls    TEXT NOT NULL DEFAULT '[]',
  landing_page_urls  TEXT NOT NULL DEFAULT '[]',
  crossref_pdf_links TEXT NOT NULL DEFAULT '[]',
  license_url        TEXT,
  recon_at           TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_recon_cache_recon_at ON recon_cache(recon_at);

-- ─── 版面分析 ───

CREATE TABLE layout_blocks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id      TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  page_index    INTEGER NOT NULL,
  block_type    TEXT NOT NULL,
  bbox_x        REAL NOT NULL,
  bbox_y        REAL NOT NULL,
  bbox_w        REAL NOT NULL,
  bbox_h        REAL NOT NULL,
  confidence    REAL NOT NULL,
  reading_order INTEGER NOT NULL DEFAULT 0,
  column_index  INTEGER NOT NULL DEFAULT -1,
  text_content  TEXT,
  char_start    INTEGER,
  char_end      INTEGER,
  model_version TEXT NOT NULL DEFAULT 'unknown',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_layout_blocks_paper_page ON layout_blocks(paper_id, page_index);
CREATE INDEX idx_layout_blocks_paper ON layout_blocks(paper_id);

CREATE TABLE section_boundaries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id   TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  title      TEXT NOT NULL,
  depth      INTEGER NOT NULL DEFAULT 1,
  char_start INTEGER NOT NULL,
  char_end   INTEGER NOT NULL,
  page_start INTEGER NOT NULL,
  page_end   INTEGER NOT NULL,
  UNIQUE(paper_id, char_start)
);

CREATE INDEX idx_section_boundaries_paper ON section_boundaries(paper_id);

-- ─── 会话状态 ───

CREATE TABLE session_memory (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  content          TEXT NOT NULL,
  source           TEXT NOT NULL,
  linked_entities  TEXT NOT NULL DEFAULT '[]',
  importance       REAL NOT NULL,
  created_at       INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  tags             TEXT
);

CREATE INDEX idx_sm_importance ON session_memory(importance DESC);

CREATE TABLE session_conversation (
  key        TEXT PRIMARY KEY,
  messages   TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── OCR 行数据 ───

CREATE TABLE ocr_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id    TEXT    NOT NULL,
  page_index  INTEGER NOT NULL,
  line_index  INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  bbox_x      REAL    NOT NULL,
  bbox_y      REAL    NOT NULL,
  bbox_w      REAL    NOT NULL,
  bbox_h      REAL    NOT NULL,
  confidence  REAL    NOT NULL DEFAULT 0,
  words_json  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ocr_lines_paper_page ON ocr_lines(paper_id, page_index);
CREATE INDEX idx_ocr_lines_paper ON ocr_lines(paper_id);

-- ─── 文章节元数据 ───

CREATE TABLE article_section_meta (
  article_id          TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  section_id          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  writing_instruction TEXT,
  concept_ids         TEXT NOT NULL DEFAULT '[]',
  paper_ids           TEXT NOT NULL DEFAULT '[]',
  ai_model            TEXT,
  evidence_status     TEXT,
  evidence_gaps       TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, section_id)
);

CREATE INDEX idx_article_section_meta_article ON article_section_meta(article_id);

-- ─── 文章节版本 ───

CREATE TABLE article_section_versions (
  article_id    TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  section_id    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  document_json TEXT,
  content_hash  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, section_id, version)
);

CREATE INDEX idx_article_section_versions_lookup ON article_section_versions(article_id, section_id, version DESC);

-- ─── 草稿层 ───

CREATE TABLE article_drafts (
  id                TEXT PRIMARY KEY,
  article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'drafting',
  document_json     TEXT NOT NULL,
  based_on_draft_id TEXT REFERENCES article_drafts(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'manual',
  language          TEXT,
  audience          TEXT,
  writing_style     TEXT,
  csl_style_id      TEXT,
  abstract          TEXT,
  keywords          TEXT NOT NULL DEFAULT '[]',
  target_word_count INTEGER,
  last_opened_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_article_drafts_article ON article_drafts(article_id, updated_at DESC);

CREATE TABLE draft_section_meta (
  draft_id            TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
  section_id          TEXT NOT NULL,
  lineage_id          TEXT NOT NULL,
  based_on_section_id TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  writing_instruction TEXT,
  concept_ids         TEXT NOT NULL DEFAULT '[]',
  paper_ids           TEXT NOT NULL DEFAULT '[]',
  ai_model            TEXT,
  evidence_status     TEXT,
  evidence_gaps       TEXT NOT NULL DEFAULT '[]',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (draft_id, section_id)
);

CREATE INDEX idx_draft_section_meta_draft ON draft_section_meta(draft_id);
CREATE INDEX idx_draft_section_meta_lineage ON draft_section_meta(draft_id, lineage_id);

CREATE TABLE draft_versions (
  draft_id      TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  document_json TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  summary       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (draft_id, version)
);

CREATE INDEX idx_draft_versions_lookup ON draft_versions(draft_id, version DESC);

CREATE TABLE draft_asset_references (
  draft_id      TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES article_assets(id) ON DELETE CASCADE,
  referenced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (draft_id, asset_id)
);

CREATE INDEX idx_draft_asset_refs_asset ON draft_asset_references(asset_id);

CREATE TABLE draft_generation_jobs (
  job_id           TEXT PRIMARY KEY,
  article_id       TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  draft_id         TEXT NOT NULL REFERENCES article_drafts(id) ON DELETE CASCADE,
  source_draft_id  TEXT REFERENCES article_drafts(id) ON DELETE SET NULL,
  operation        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  stage            TEXT NOT NULL DEFAULT 'initializing',
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total   INTEGER NOT NULL DEFAULT 0,
  checkpoint       TEXT,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_draft_generation_jobs_article ON draft_generation_jobs(article_id, updated_at DESC);
CREATE INDEX idx_draft_generation_jobs_draft ON draft_generation_jobs(draft_id, updated_at DESC);

-- ─── articles.default_draft_id（循环引用，须在 article_drafts 之后添加） ───

ALTER TABLE articles ADD COLUMN default_draft_id TEXT REFERENCES article_drafts(id) ON DELETE SET NULL;

-- ═══ updated_at 自动维护触发器 ═══

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

CREATE TRIGGER trg_chunks_before_delete BEFORE DELETE ON chunks
FOR EACH ROW
BEGIN
  DELETE FROM chunks_vec WHERE rowid = OLD.rowid;
END;

-- ═══ FTS5 同步触发器 ═══

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
