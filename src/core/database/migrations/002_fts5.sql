-- ═══ FTS5 全文搜索虚拟表 ═══
-- BM25 词法检索，弥补向量检索在专有名词/罕见实体上的盲区

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  content='chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- 自动同步触发器：chunks 表变更时同步到 FTS5

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

-- 回填已有数据
INSERT INTO chunks_fts(rowid, chunk_id, text) SELECT rowid, chunk_id, text FROM chunks;
