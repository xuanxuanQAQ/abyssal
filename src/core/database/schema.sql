-- Abyssal SQLite Schema
-- Initialized with: PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
-- PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-64000;

-- ═══ 论文与书目 ═══

CREATE TABLE IF NOT EXISTS papers (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    authors         TEXT,
    year            INTEGER,
    doi             TEXT UNIQUE,
    arxiv_id        TEXT,
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
    abstract        TEXT,
    citation_count  INTEGER,
    paper_type      TEXT,
    bibtex_key      TEXT,
    biblio_complete INTEGER DEFAULT 0,
    fulltext_status TEXT DEFAULT 'pending',
    fulltext_path   TEXT,
    text_path       TEXT,
    analysis_status TEXT DEFAULT 'pending',
    analysis_path   TEXT,
    relevance       TEXT,
    decision_note   TEXT,
    source          TEXT,
    discovered_at   TEXT,
    updated_at      TEXT
);

-- ═══ 引用关系 ═══

CREATE TABLE IF NOT EXISTS citations (
    citing_id   TEXT NOT NULL,
    cited_id    TEXT NOT NULL,
    PRIMARY KEY (citing_id, cited_id),
    FOREIGN KEY (citing_id) REFERENCES papers(id),
    FOREIGN KEY (cited_id) REFERENCES papers(id)
);

-- ═══ 概念框架 ═══

CREATE TABLE IF NOT EXISTS concepts (
    id          TEXT PRIMARY KEY,
    name_zh     TEXT,
    name_en     TEXT,
    layer       TEXT,
    definition  TEXT,
    keywords    TEXT
);

-- ═══ 论文-概念映射 ═══

CREATE TABLE IF NOT EXISTS paper_concept_map (
    paper_id      TEXT NOT NULL,
    concept_id    TEXT NOT NULL,
    relation      TEXT,
    confidence    REAL,
    evidence      TEXT,
    annotation_id INTEGER,
    reviewed      INTEGER DEFAULT 0,
    PRIMARY KEY (paper_id, concept_id),
    FOREIGN KEY (paper_id) REFERENCES papers(id),
    FOREIGN KEY (concept_id) REFERENCES concepts(id),
    FOREIGN KEY (annotation_id) REFERENCES annotations(id)
);

-- ═══ PDF 标注 ═══

CREATE TABLE IF NOT EXISTS annotations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id    TEXT NOT NULL,
    page        INTEGER,
    rect        TEXT,
    text        TEXT,
    type        TEXT,
    color       TEXT,
    comment     TEXT,
    concept_id  TEXT,
    created_at  TEXT,
    FOREIGN KEY (paper_id) REFERENCES papers(id),
    FOREIGN KEY (concept_id) REFERENCES concepts(id)
);

-- ═══ 种子论文 ═══

CREATE TABLE IF NOT EXISTS seeds (
    paper_id    TEXT PRIMARY KEY,
    seed_type   TEXT,
    note        TEXT,
    FOREIGN KEY (paper_id) REFERENCES papers(id)
);

-- ═══ 检索日志 ═══

CREATE TABLE IF NOT EXISTS search_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    query       TEXT,
    source      TEXT,
    result_count INTEGER,
    timestamp   TEXT
);

-- ═══ 文本块 + 向量索引 ═══

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id    TEXT PRIMARY KEY,
    paper_id    TEXT,
    section     TEXT,
    page_start  INTEGER,
    page_end    INTEGER,
    text        TEXT NOT NULL,
    token_count INTEGER,
    source      TEXT DEFAULT 'paper',
    FOREIGN KEY (paper_id) REFERENCES papers(id)
);

-- chunks_vec virtual table created separately via sqlite-vec extension:
-- CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[1536]);

-- ═══ 写作管线 ═══

CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    style       TEXT,
    csl_style   TEXT,
    language    TEXT DEFAULT 'zh',
    status      TEXT DEFAULT 'drafting',
    created_at  TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS outlines (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id          INTEGER NOT NULL,
    seq                 INTEGER NOT NULL,
    title               TEXT,
    thesis              TEXT,
    writing_instruction TEXT,
    concept_ids         TEXT,
    paper_ids           TEXT,
    status              TEXT DEFAULT 'pending',
    FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE TABLE IF NOT EXISTS sections (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    outline_id      INTEGER NOT NULL,
    version         INTEGER DEFAULT 1,
    content         TEXT,
    backend         TEXT,
    human_edits     TEXT,
    created_at      TEXT,
    FOREIGN KEY (outline_id) REFERENCES outlines(id)
);

-- ═══ 多层语义关系网络 ═══

CREATE TABLE IF NOT EXISTS paper_relations (
    entity_a_id     TEXT NOT NULL,
    entity_a_type   TEXT NOT NULL,
    entity_b_id     TEXT NOT NULL,
    entity_b_type   TEXT NOT NULL,
    relation_type   TEXT NOT NULL,
    weight          REAL,
    metadata        TEXT,
    computed_at     TEXT
);

-- ═══ 索引 ═══

CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(fulltext_status, analysis_status);
CREATE INDEX IF NOT EXISTS idx_papers_relevance ON papers(relevance);
CREATE INDEX IF NOT EXISTS idx_pcm_concept ON paper_concept_map(concept_id);
CREATE INDEX IF NOT EXISTS idx_pcm_reviewed ON paper_concept_map(reviewed);
CREATE INDEX IF NOT EXISTS idx_annotations_paper ON annotations(paper_id);
CREATE INDEX IF NOT EXISTS idx_annotations_concept ON annotations(concept_id);
CREATE INDEX IF NOT EXISTS idx_chunks_paper ON chunks(paper_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
CREATE INDEX IF NOT EXISTS idx_outlines_article ON outlines(article_id);
CREATE INDEX IF NOT EXISTS idx_sections_outline ON sections(outline_id);
CREATE INDEX IF NOT EXISTS idx_relations_entity ON paper_relations(entity_a_id, entity_a_type);
CREATE INDEX IF NOT EXISTS idx_relations_type ON paper_relations(relation_type);
