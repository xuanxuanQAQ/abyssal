// ═══ 统计与完整性检查 ═══
// §10: getStats / checkIntegrity

import type Database from 'better-sqlite3';

// ─── §10.1 getStats ───

export interface DatabaseStats {
  papers: {
    total: number;
    fulltextPending: number;
    fulltextAcquired: number;
    fulltextAbstractOnly: number;
    fulltextFailed: number;
    analysisPending: number;
    analysisAnalyzed: number;
    analysisReviewed: number;
    analysisIntegrated: number;
    analysisParseFailed: number;
    relevanceHigh: number;
    relevanceMedium: number;
    relevanceLow: number;
    relevanceExcluded: number;
  };
  concepts: {
    total: number;
    tentative: number;
    working: number;
    established: number;
    deprecatedCount: number;
  };
  chunks: {
    total: number;
    paperChunks: number;
    memoChunks: number;
    noteChunks: number;
    privateChunks: number;
    annotationChunks: number;
    figureChunks: number;
  };
  mappings: {
    total: number;
    reviewed: number;
  };
  annotations: number;
  articles: number;
  memos: number;
  notes: number;
  pendingSuggestions: number;
  dbSizeBytes: number;
}

export function getStats(db: Database.Database): DatabaseStats {
  const statsFn = db.transaction(() => {
    const paperRow = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN fulltext_status = 'pending' THEN 1 ELSE 0 END) AS fulltext_pending,
        SUM(CASE WHEN fulltext_status = 'acquired' THEN 1 ELSE 0 END) AS fulltext_acquired,
        SUM(CASE WHEN fulltext_status = 'abstract_only' THEN 1 ELSE 0 END) AS fulltext_abstract_only,
        SUM(CASE WHEN fulltext_status = 'failed' THEN 1 ELSE 0 END) AS fulltext_failed,
        SUM(CASE WHEN analysis_status = 'pending' THEN 1 ELSE 0 END) AS analysis_pending,
        SUM(CASE WHEN analysis_status = 'analyzed' THEN 1 ELSE 0 END) AS analysis_analyzed,
        SUM(CASE WHEN analysis_status = 'reviewed' THEN 1 ELSE 0 END) AS analysis_reviewed,
        SUM(CASE WHEN analysis_status = 'integrated' THEN 1 ELSE 0 END) AS analysis_integrated,
        SUM(CASE WHEN analysis_status = 'parse_failed' THEN 1 ELSE 0 END) AS analysis_parse_failed,
        SUM(CASE WHEN relevance = 'high' THEN 1 ELSE 0 END) AS relevance_high,
        SUM(CASE WHEN relevance = 'medium' THEN 1 ELSE 0 END) AS relevance_medium,
        SUM(CASE WHEN relevance = 'low' THEN 1 ELSE 0 END) AS relevance_low,
        SUM(CASE WHEN relevance = 'excluded' THEN 1 ELSE 0 END) AS relevance_excluded
      FROM papers
    `).get() as Record<string, number>;

    const conceptRow = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN maturity = 'tentative' THEN 1 ELSE 0 END) AS tentative,
        SUM(CASE WHEN maturity = 'working' THEN 1 ELSE 0 END) AS working,
        SUM(CASE WHEN maturity = 'established' THEN 1 ELSE 0 END) AS established,
        SUM(CASE WHEN deprecated = 1 THEN 1 ELSE 0 END) AS deprecated_count
      FROM concepts
    `).get() as Record<string, number>;

    const chunkRow = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN source = 'paper' THEN 1 ELSE 0 END) AS paper_chunks,
        SUM(CASE WHEN source = 'memo' THEN 1 ELSE 0 END) AS memo_chunks,
        SUM(CASE WHEN source = 'note' THEN 1 ELSE 0 END) AS note_chunks,
        SUM(CASE WHEN source = 'private' THEN 1 ELSE 0 END) AS private_chunks,
        SUM(CASE WHEN source = 'annotation' THEN 1 ELSE 0 END) AS annotation_chunks,
        SUM(CASE WHEN source = 'figure' THEN 1 ELSE 0 END) AS figure_chunks
      FROM chunks
    `).get() as Record<string, number>;

    const mappingTotal = (
      db.prepare('SELECT COUNT(*) AS cnt FROM paper_concept_map').get() as { cnt: number }
    ).cnt;
    const mappingReviewed = (
      db.prepare('SELECT COUNT(*) AS cnt FROM paper_concept_map WHERE reviewed = 1').get() as { cnt: number }
    ).cnt;

    const annotations = (
      db.prepare('SELECT COUNT(*) AS cnt FROM annotations').get() as { cnt: number }
    ).cnt;
    const articles = (
      db.prepare('SELECT COUNT(*) AS cnt FROM articles').get() as { cnt: number }
    ).cnt;
    const memos = (
      db.prepare('SELECT COUNT(*) AS cnt FROM research_memos').get() as { cnt: number }
    ).cnt;
    const notes = (
      db.prepare('SELECT COUNT(*) AS cnt FROM research_notes').get() as { cnt: number }
    ).cnt;
    const pendingSuggestions = (
      db.prepare("SELECT COUNT(*) AS cnt FROM suggested_concepts WHERE status = 'pending'").get() as { cnt: number }
    ).cnt;

    // 数据库文件大小
    const pageCount = (
      db.pragma('page_count') as [{ page_count: number }]
    )[0]!.page_count;
    const pageSize = (
      db.pragma('page_size') as [{ page_size: number }]
    )[0]!.page_size;
    const dbSizeBytes = pageCount * pageSize;

    return {
      papers: {
        total: paperRow['total'] ?? 0,
        fulltextPending: paperRow['fulltext_pending'] ?? 0,
        fulltextAcquired: paperRow['fulltext_acquired'] ?? 0,
        fulltextAbstractOnly: paperRow['fulltext_abstract_only'] ?? 0,
        fulltextFailed: paperRow['fulltext_failed'] ?? 0,
        analysisPending: paperRow['analysis_pending'] ?? 0,
        analysisAnalyzed: paperRow['analysis_analyzed'] ?? 0,
        analysisReviewed: paperRow['analysis_reviewed'] ?? 0,
        analysisIntegrated: paperRow['analysis_integrated'] ?? 0,
        analysisParseFailed: paperRow['analysis_parse_failed'] ?? 0,
        relevanceHigh: paperRow['relevance_high'] ?? 0,
        relevanceMedium: paperRow['relevance_medium'] ?? 0,
        relevanceLow: paperRow['relevance_low'] ?? 0,
        relevanceExcluded: paperRow['relevance_excluded'] ?? 0,
      },
      concepts: {
        total: conceptRow['total'] ?? 0,
        tentative: conceptRow['tentative'] ?? 0,
        working: conceptRow['working'] ?? 0,
        established: conceptRow['established'] ?? 0,
        deprecatedCount: conceptRow['deprecated_count'] ?? 0,
      },
      chunks: {
        total: chunkRow['total'] ?? 0,
        paperChunks: chunkRow['paper_chunks'] ?? 0,
        memoChunks: chunkRow['memo_chunks'] ?? 0,
        noteChunks: chunkRow['note_chunks'] ?? 0,
        privateChunks: chunkRow['private_chunks'] ?? 0,
        annotationChunks: chunkRow['annotation_chunks'] ?? 0,
        figureChunks: chunkRow['figure_chunks'] ?? 0,
      },
      mappings: {
        total: mappingTotal,
        reviewed: mappingReviewed,
      },
      annotations,
      articles,
      memos,
      notes,
      pendingSuggestions,
      dbSizeBytes,
    };
  });

  return statsFn();
}

// ─── §10.2 checkIntegrity ───

export type IntegritySeverity = 'error' | 'warn' | 'info';

export interface IntegrityCheckResult {
  name: string;
  severity: IntegritySeverity;
  count: number;
  sampleIds: string[];
}

export interface IntegrityReport {
  ok: boolean;
  checks: IntegrityCheckResult[];
}

export function checkIntegrity(db: Database.Database): IntegrityReport {
  const checks: IntegrityCheckResult[] = [];

  // 1. 孤立 chunk（paper_id 不存在）
  const orphanChunks = db.prepare(`
    SELECT chunk_id FROM chunks
    WHERE paper_id IS NOT NULL
      AND paper_id NOT IN (SELECT id FROM papers)
      AND source = 'paper'
    LIMIT 10
  `).all() as { chunk_id: string }[];
  checks.push({
    name: 'orphan_chunks',
    severity: 'error',
    count: orphanChunks.length,
    sampleIds: orphanChunks.map((r) => r.chunk_id),
  });

  // 2. 孤立映射（concept_id 不存在或已废弃）
  const orphanMappings = db.prepare(`
    SELECT paper_id || ':' || concept_id AS id
    FROM paper_concept_map
    WHERE concept_id NOT IN (SELECT id FROM concepts WHERE deprecated = 0)
    LIMIT 10
  `).all() as { id: string }[];
  checks.push({
    name: 'orphan_mappings',
    severity: 'warn',
    count: orphanMappings.length,
    sampleIds: orphanMappings.map((r) => r.id),
  });

  // 3. 孤立标注
  const orphanAnnotations = db.prepare(`
    SELECT id FROM annotations
    WHERE paper_id NOT IN (SELECT id FROM papers)
    LIMIT 10
  `).all() as { id: number }[];
  checks.push({
    name: 'orphan_annotations',
    severity: 'error',
    count: orphanAnnotations.length,
    sampleIds: orphanAnnotations.map((r) => String(r.id)),
  });

  // 4. memo 缺 chunk 索引
  const unindexedMemos = db.prepare(`
    SELECT id FROM research_memos WHERE indexed = 0 LIMIT 10
  `).all() as { id: number }[];
  checks.push({
    name: 'unindexed_memos',
    severity: 'warn',
    count: unindexedMemos.length,
    sampleIds: unindexedMemos.map((r) => String(r.id)),
  });

  // 5. note 文件缺失 — 返回 file_path 列表，由调用方检查文件系统
  // 此处仅统计 note 数量
  const noteCount = (
    db.prepare('SELECT COUNT(*) AS cnt FROM research_notes').get() as { cnt: number }
  ).cnt;
  checks.push({
    name: 'note_file_existence',
    severity: 'warn',
    count: 0, // TODO: 调用方检查文件系统后更新
    sampleIds: [],
  });

  // 6. 过期的派生关系
  const staleRelations = db.prepare(`
    SELECT DISTINCT source_paper_id FROM paper_relations
    WHERE computed_at < (SELECT updated_at FROM papers WHERE id = source_paper_id)
    LIMIT 10
  `).all() as { source_paper_id: string }[];
  checks.push({
    name: 'stale_relations',
    severity: 'info',
    count: staleRelations.length,
    sampleIds: staleRelations.map((r) => r.source_paper_id),
  });

  // 7. chunks_vec 孤立行
  const orphanVec = db.prepare(`
    SELECT rowid FROM chunks_vec
    WHERE rowid NOT IN (SELECT rowid FROM chunks)
    LIMIT 10
  `).all() as { rowid: number }[];
  checks.push({
    name: 'orphan_chunks_vec',
    severity: 'error',
    count: orphanVec.length,
    sampleIds: orphanVec.map((r) => String(r.rowid)),
  });

  // 8. chunks 缺向量
  const missingVec = db.prepare(`
    SELECT rowid FROM chunks
    WHERE rowid NOT IN (SELECT rowid FROM chunks_vec)
      AND source != 'annotation'
    LIMIT 10
  `).all() as { rowid: number }[];
  checks.push({
    name: 'missing_chunk_vectors',
    severity: 'warn',
    count: missingVec.length,
    sampleIds: missingVec.map((r) => String(r.rowid)),
  });

  // 9. memo 引用不存在的论文
  const memoOrphanPapers = db.prepare(`
    SELECT DISTINCT m.id FROM research_memos m, json_each(m.paper_ids) je
    WHERE je.value NOT IN (SELECT id FROM papers)
    LIMIT 10
  `).all() as { id: number }[];
  checks.push({
    name: 'memo_orphan_papers',
    severity: 'warn',
    count: memoOrphanPapers.length,
    sampleIds: memoOrphanPapers.map((r) => String(r.id)),
  });

  // 10. memo 引用不存在的概念
  const memoOrphanConcepts = db.prepare(`
    SELECT DISTINCT m.id FROM research_memos m, json_each(m.concept_ids) je
    WHERE je.value NOT IN (SELECT id FROM concepts)
    LIMIT 10
  `).all() as { id: number }[];
  checks.push({
    name: 'memo_orphan_concepts',
    severity: 'warn',
    count: memoOrphanConcepts.length,
    sampleIds: memoOrphanConcepts.map((r) => String(r.id)),
  });

  const hasErrors = checks.some((c) => c.severity === 'error' && c.count > 0);
  return { ok: !hasErrors, checks };
}
