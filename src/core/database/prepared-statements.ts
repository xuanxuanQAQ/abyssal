// ═══ 预编译语句缓存 ═══
// §1.6: 使用 db.prepare(sql) 预编译高频 SQL 语句。
// SQL 解析和查询计划生成仅执行一次，后续调用直接绑定参数执行。
//
// 线程安全：Statement 对象与创建它的 Database 对象绑定——不可跨线程使用。
// Worker Thread 需要独立 prepare 自己的语句。

import type Database from 'better-sqlite3';

// ─── 列检测缓存 ───

const layoutColumnsCache = new WeakMap<Database.Database, boolean>();

/**
 * 检测 chunks 表是否已包含 migration 016 新增的布局列。
 * 结果按连接实例缓存，避免重复 PRAGMA 查询。
 */
export function hasLayoutColumns(db: Database.Database): boolean {
  let result = layoutColumnsCache.get(db);
  if (result === undefined) {
    const cols = db.pragma('table_info(chunks)') as Array<{ name: string }>;
    result = cols.some((c) => c.name === 'block_type');
    layoutColumnsCache.set(db, result);
  }
  return result;
}

/**
 * 预编译语句集合。
 *
 * 每个字段对应一条高频 SQL——在 DatabaseService 初始化时一次性 prepare，
 * 后续 DAO 层可通过 StatementCache 直接执行绑定参数。
 */
export interface StatementCache {
  readonly getPaperById: Database.Statement;
  readonly upsertPaper: Database.Statement;
  readonly insertChunk: Database.Statement;
  readonly insertChunkVec: Database.Statement;
  readonly checkChunkExists: Database.Statement;
  readonly knnSearch: Database.Statement;
  readonly getConceptMappings: Database.Statement;
  readonly getMemosByPaper: Database.Statement;
  readonly getMemosByConcept: Database.Statement;
  /** migration 016 布局列是否可用 */
  readonly hasLayout: boolean;
}

/**
 * 批量预编译高频 SQL 语句。
 *
 * @param db - better-sqlite3 Database 实例
 * @param hasVec - 是否加载了 sqlite-vec 扩展（未加载时跳过 vec 相关语句）
 */
export function createStatements(
  db: Database.Database,
  hasVec: boolean,
): StatementCache {
  return {
    // ─── 论文 ───
    getPaperById: db.prepare('SELECT * FROM papers WHERE id = ?'),

    // §1.4 完整 UPSERT 合并语义
    upsertPaper: db.prepare(`
      INSERT INTO papers (
        id, title, authors, year, doi, arxiv_id, abstract,
        citation_count, paper_type, source, venue, journal, volume,
        issue, pages, publisher, isbn, edition, editors, book_title,
        series, issn, pmid, pmcid, url, bibtex_key, biblio_complete,
        fulltext_status, fulltext_path, text_path, analysis_status,
        analysis_path, relevance, decision_note, failure_reason,
        discovered_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      ) ON CONFLICT(id) DO UPDATE SET
        title = CASE WHEN length(excluded.title) > length(papers.title)
                THEN excluded.title ELSE papers.title END,
        authors = CASE WHEN json_array_length(excluded.authors) > json_array_length(papers.authors)
                  THEN excluded.authors ELSE papers.authors END,
        year = COALESCE(excluded.year, papers.year),
        doi = COALESCE(excluded.doi, papers.doi),
        arxiv_id = COALESCE(excluded.arxiv_id, papers.arxiv_id),
        abstract = COALESCE(excluded.abstract, papers.abstract),
        citation_count = COALESCE(MAX(excluded.citation_count, papers.citation_count),
                         excluded.citation_count, papers.citation_count),
        paper_type = CASE WHEN papers.paper_type = 'unknown'
                     THEN excluded.paper_type ELSE papers.paper_type END,
        venue = COALESCE(excluded.venue, papers.venue),
        journal = COALESCE(excluded.journal, papers.journal),
        volume = COALESCE(excluded.volume, papers.volume),
        issue = COALESCE(excluded.issue, papers.issue),
        pages = COALESCE(excluded.pages, papers.pages),
        publisher = COALESCE(excluded.publisher, papers.publisher),
        isbn = COALESCE(excluded.isbn, papers.isbn),
        edition = COALESCE(excluded.edition, papers.edition),
        editors = CASE WHEN excluded.editors IS NOT NULL
                    AND (papers.editors IS NULL
                      OR json_array_length(excluded.editors) > json_array_length(papers.editors))
                  THEN excluded.editors ELSE papers.editors END,
        book_title = COALESCE(excluded.book_title, papers.book_title),
        series = COALESCE(excluded.series, papers.series),
        issn = COALESCE(excluded.issn, papers.issn),
        pmid = COALESCE(excluded.pmid, papers.pmid),
        pmcid = COALESCE(excluded.pmcid, papers.pmcid),
        url = COALESCE(excluded.url, papers.url),
        bibtex_key = COALESCE(excluded.bibtex_key, papers.bibtex_key),
        biblio_complete = MAX(excluded.biblio_complete, papers.biblio_complete),
        fulltext_status = COALESCE(excluded.fulltext_status, papers.fulltext_status),
        fulltext_path = COALESCE(excluded.fulltext_path, papers.fulltext_path),
        text_path = COALESCE(excluded.text_path, papers.text_path),
        analysis_status = COALESCE(excluded.analysis_status, papers.analysis_status),
        analysis_path = COALESCE(excluded.analysis_path, papers.analysis_path),
        relevance = COALESCE(excluded.relevance, papers.relevance),
        decision_note = COALESCE(excluded.decision_note, papers.decision_note),
        failure_reason = COALESCE(excluded.failure_reason, papers.failure_reason),
        updated_at = excluded.updated_at
    `),

    // ─── 文本块（含 created_at） ───
    // 布局列（block_type, reading_order, column_layout）由 migration 016 添加，
    // 旧 schema 中不存在时使用不含布局列的 INSERT 避免崩溃。
    insertChunk: hasLayoutColumns(db)
      ? db.prepare(`
          INSERT INTO chunks (
            chunk_id, paper_id, section_label, section_title, section_type,
            page_start, page_end, text, token_count, source,
            position_ratio, parent_chunk_id, chunk_index,
            context_before, context_after, created_at,
            block_type, reading_order, column_layout
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      : db.prepare(`
          INSERT INTO chunks (
            chunk_id, paper_id, section_label, section_title, section_type,
            page_start, page_end, text, token_count, source,
            position_ratio, parent_chunk_id, chunk_index,
            context_before, context_after, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),

    hasLayout: hasLayoutColumns(db),

    // §6.1 幂等写入预检（高频查询）
    checkChunkExists: db.prepare('SELECT rowid FROM chunks WHERE chunk_id = ?'),

    // ─── 向量（sqlite-vec 不可用时返回空操作语句） ───
    insertChunkVec: hasVec
      ? db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
      : db.prepare('SELECT 1 WHERE 0'), // no-op 占位

    knnSearch: hasVec
      ? db.prepare(`
          SELECT v.rowid, v.distance, c.chunk_id, c.paper_id, c.text, c.source,
                 c.section_label, c.section_title, c.token_count
          FROM chunks_vec v
          JOIN chunks c ON c.rowid = v.rowid
          WHERE v.embedding MATCH ?
          AND k = ?
          ORDER BY v.distance
        `)
      : db.prepare('SELECT 1 WHERE 0'), // no-op 占位

    // ─── 映射 ───
    getConceptMappings: db.prepare(
      'SELECT * FROM paper_concept_map WHERE concept_id = ?',
    ),

    // ─── Memo 查询（via 映射表，O(log N) 索引查找） ───
    getMemosByPaper: db.prepare(`
      SELECT m.* FROM research_memos m
      JOIN memo_paper_map mp ON mp.memo_id = m.id
      WHERE mp.paper_id = ?
    `),

    getMemosByConcept: db.prepare(`
      SELECT m.* FROM research_memos m
      JOIN memo_concept_map mc ON mc.memo_id = m.id
      WHERE mc.concept_id = ?
    `),
  };
}

/**
 * 释放全部预编译语句引用。
 *
 * 遍历缓存中的所有 Statement 对象，将其从引用图中断开。
 * better-sqlite3 的 Statement 在 Database.close() 时自动 finalize，
 * 但在 runHotMigration 场景中连接未关闭就执行 DDL，
 * 显式清除引用可帮助 GC 回收闭包中的 Statement 对象并释放 SQLite 锁。
 */
export function releaseStatements(
  cache: StatementCache | null,
): null {
  if (cache) {
    // 遍历所有 Statement 字段，将其引用断开以释放 SQLite 内部 stmt handle。
    // better-sqlite3 Statement 没有公开 finalize()，但 db.close() 前
    // 清除所有引用可确保 DDL 操作（ALTER TABLE 等）不会遇到
    // "database table is locked" 错误。
    for (const key of Object.keys(cache)) {
      (cache as unknown as Record<string, unknown>)[key] = undefined;
    }
  }
  return null;
}
