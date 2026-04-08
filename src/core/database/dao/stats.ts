// ═══ 统计与完整性检查 ═══
// §8.1: 运行时指标（含 WAL 文件大小、空闲页面、页面大小）
// §8.2: 完整性检查（含 PRAGMA integrity_check、foreign_key_check、维度抽样）

import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import { hasVecTable } from './chunks';

// ─── §8.1 getStats ───

export interface DatabaseStats {
  papers: {
    total: number;
    fulltextNotAttempted: number;
    fulltextPending: number;
    fulltextAvailable: number;
    fulltextAbstractOnly: number;
    fulltextFailed: number;
    analysisNotStarted: number;
    analysisInProgress: number;
    analysisCompleted: number;
    analysisNeedsReview: number;
    analysisFailed: number;
    analysisSkipped: number;
    relevanceSeed: number;
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
  /** WAL 文件大小（字节），-1 表示 WAL 文件不存在 */
  walSizeBytes: number;
  /** 空闲页面数（PRAGMA freelist_count） */
  freePageCount: number;
  /** 页面大小（PRAGMA page_size），固定 4096 B */
  pageSize: number;
}

export function getStats(db: Database.Database): DatabaseStats {
  const statsFn = db.transaction(() => {
    const paperRow = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN fulltext_status = 'not_attempted' THEN 1 ELSE 0 END) AS fulltext_not_attempted,
        SUM(CASE WHEN fulltext_status = 'pending' THEN 1 ELSE 0 END) AS fulltext_pending,
        SUM(CASE WHEN fulltext_status = 'available' THEN 1 ELSE 0 END) AS fulltext_available,
        SUM(CASE WHEN fulltext_status = 'abstract_only' THEN 1 ELSE 0 END) AS fulltext_abstract_only,
        SUM(CASE WHEN fulltext_status = 'failed' THEN 1 ELSE 0 END) AS fulltext_failed,
        SUM(CASE WHEN analysis_status = 'not_started' THEN 1 ELSE 0 END) AS analysis_not_started,
        SUM(CASE WHEN analysis_status = 'in_progress' THEN 1 ELSE 0 END) AS analysis_in_progress,
        SUM(CASE WHEN analysis_status = 'completed' THEN 1 ELSE 0 END) AS analysis_completed,
        SUM(CASE WHEN analysis_status = 'needs_review' THEN 1 ELSE 0 END) AS analysis_needs_review,
        SUM(CASE WHEN analysis_status = 'failed' THEN 1 ELSE 0 END) AS analysis_failed,
        SUM(CASE WHEN analysis_status = 'skipped' THEN 1 ELSE 0 END) AS analysis_skipped,
        SUM(CASE WHEN relevance = 'seed' THEN 1 ELSE 0 END) AS relevance_seed,
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

    // §8.1: 空闲页面数
    const freePageCount = (
      db.pragma('freelist_count') as [{ freelist_count: number }]
    )[0]!.freelist_count;

    // §8.1: WAL 文件大小
    let walSizeBytes = -1;
    try {
      const walPath = db.name + '-wal';
      const stat = fs.statSync(walPath);
      walSizeBytes = stat.size;
    } catch {
      // WAL 文件不存在（非 WAL 模式或已 checkpoint）
    }

    return {
      papers: {
        total: paperRow['total'] ?? 0,
        fulltextNotAttempted: paperRow['fulltext_not_attempted'] ?? 0,
        fulltextPending: paperRow['fulltext_pending'] ?? 0,
        fulltextAvailable: paperRow['fulltext_available'] ?? 0,
        fulltextAbstractOnly: paperRow['fulltext_abstract_only'] ?? 0,
        fulltextFailed: paperRow['fulltext_failed'] ?? 0,
        analysisNotStarted: paperRow['analysis_not_started'] ?? 0,
        analysisInProgress: paperRow['analysis_in_progress'] ?? 0,
        analysisCompleted: paperRow['analysis_completed'] ?? 0,
        analysisNeedsReview: paperRow['analysis_needs_review'] ?? 0,
        analysisFailed: paperRow['analysis_failed'] ?? 0,
        analysisSkipped: paperRow['analysis_skipped'] ?? 0,
        relevanceSeed: paperRow['relevance_seed'] ?? 0,
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
      walSizeBytes,
      freePageCount,
      pageSize,
    };
  });

  return statsFn();
}

// ─── §8.2 checkIntegrity ───

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

  // §8.2: PRAGMA integrity_check — B-tree 结构、页面空闲列表、索引一致性
  try {
    const integrityRows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const isOk = integrityRows.length === 1 && integrityRows[0]!.integrity_check === 'ok';
    checks.push({
      name: 'sqlite_integrity',
      severity: isOk ? 'info' : 'error',
      count: isOk ? 0 : integrityRows.length,
      sampleIds: isOk ? [] : integrityRows.slice(0, 5).map((r) => r.integrity_check),
    });
  } catch (err) {
    checks.push({
      name: 'sqlite_integrity',
      severity: 'error',
      count: 1,
      sampleIds: [(err as Error).message.slice(0, 200)],
    });
  }

  // §8.2: PRAGMA foreign_key_check — 外键引用完整性
  try {
    const fkRows = db.pragma('foreign_key_check') as Array<{
      table: string; rowid: number; parent: string; fkid: number;
    }>;
    checks.push({
      name: 'foreign_key_integrity',
      severity: fkRows.length > 0 ? 'error' : 'info',
      count: fkRows.length,
      sampleIds: fkRows.slice(0, 10).map(
        (r) => `${r.table}:${r.rowid}→${r.parent}`,
      ),
    });
  } catch (err) {
    checks.push({
      name: 'foreign_key_integrity',
      severity: 'error',
      count: 1,
      sampleIds: [(err as Error).message.slice(0, 200)],
    });
  }

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

  // 5. note 文件缺失检查——返回所有 file_path 供调用方（Orchestrator）用 fs.existsSync 验证
  const noteFiles = db.prepare(
    'SELECT id, file_path FROM research_notes LIMIT 100',
  ).all() as Array<{ id: string; file_path: string }>;
  checks.push({
    name: 'note_file_existence',
    severity: 'warn',
    count: noteFiles.length,
    sampleIds: noteFiles.map((r) => `${r.id}:${r.file_path}`),
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

  // 7. chunks_vec 孤立行（仅在 vec 表存在时检查）
  if (hasVecTable(db)) {
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
  } // end hasVecTable

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

  // §8.2: 嵌入维度抽样验证（随机 10 条 chunks_vec，验证向量字节长度）
  if (hasVecTable(db)) try {
    const metaDimRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'embedding_dimension'",
    ).get() as { value: string } | undefined;

    if (metaDimRow) {
      const expectedDim = parseInt(metaDimRow.value, 10);
      const expectedBytes = expectedDim * 4; // float32

      // sqlite-vec 的 embedding 列返回 blob，用 length() 检查字节长度
      const sampleRows = db.prepare(`
        SELECT rowid, length(embedding) AS embed_len
        FROM chunks_vec
        ORDER BY RANDOM()
        LIMIT 10
      `).all() as Array<{ rowid: number; embed_len: number }>;

      const badRows = sampleRows.filter((r) => r.embed_len !== expectedBytes);
      checks.push({
        name: 'embedding_dimension_consistency',
        severity: badRows.length > 0 ? 'error' : 'info',
        count: badRows.length,
        sampleIds: badRows.map(
          (r) => `rowid=${r.rowid}(len=${r.embed_len},expected=${expectedBytes})`,
        ),
      });
    }
  } catch {
    // _meta 或 chunks_vec 不可用——跳过
  }

  const hasErrors = checks.some((c) => c.severity === 'error' && c.count > 0);
  return { ok: !hasErrors, checks };
}
