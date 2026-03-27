// ═══ 向量引擎诊断工具 ═══
// §10.1-10.4: 向量抽样验证、距离分布分析、rowid 一致性、索引统计

import type Database from 'better-sqlite3';

// ─── §10.1 向量抽样验证 ───

export interface VectorLengthSample {
  rowid: number;
  vecBytes: number;
  expectedBytes: number;
  valid: boolean;
}

/**
 * 随机抽取 N 个向量，验证字节长度 = dimension × 4。
 */
export function sampleVectorLengths(
  db: Database.Database,
  expectedDimension: number,
  count: number = 10,
): VectorLengthSample[] {
  const expectedBytes = expectedDimension * 4;
  const rows = db.prepare(`
    SELECT rowid, length(embedding) AS vec_bytes
    FROM chunks_vec
    ORDER BY RANDOM()
    LIMIT ?
  `).all(count) as Array<{ rowid: number; vec_bytes: number }>;

  return rows.map((r) => ({
    rowid: r.rowid,
    vecBytes: r.vec_bytes,
    expectedBytes,
    valid: r.vec_bytes === expectedBytes,
  }));
}

// ─── §10.2 距离分布分析 ───

export interface DistanceBucket {
  bucket: string;
  scoreRange: string;
  count: number;
}

/**
 * 对查询向量分析距离分布——评估嵌入质量。
 *
 * 健康的嵌入空间应呈正态分布——大部分在 moderate 区间。
 * 如果大量集中在 very_similar，说明嵌入模型区分度不足。
 */
export function analyzeDistanceDistribution(
  db: Database.Database,
  queryVec: Buffer,
  k: number = 1000,
): DistanceBucket[] {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN v.distance < 0.5 THEN 'very_similar'
        WHEN v.distance < 1.0 THEN 'similar'
        WHEN v.distance < 1.414 THEN 'moderate'
        ELSE 'dissimilar'
      END AS bucket,
      CASE
        WHEN v.distance < 0.5 THEN 'score>0.94'
        WHEN v.distance < 1.0 THEN 'score>0.75'
        WHEN v.distance < 1.414 THEN 'score>0.50'
        ELSE 'score<=0.50'
      END AS score_range,
      COUNT(*) AS count
    FROM chunks_vec v
    WHERE v.embedding MATCH ?
      AND k = ?
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'very_similar' THEN 1
        WHEN 'similar' THEN 2
        WHEN 'moderate' THEN 3
        ELSE 4
      END
  `).all(queryVec, k) as Array<{ bucket: string; score_range: string; count: number }>;

  return rows.map((r) => ({
    bucket: r.bucket,
    scoreRange: r.score_range,
    count: r.count,
  }));
}

// ─── §10.3 rowid 一致性检查 ───

export interface RowidConsistencyResult {
  /** chunks 有记录但 chunks_vec 缺失（向量丢失） */
  missingVectors: Array<{ rowid: number; chunkId: string; source: string }>;
  /** chunks_vec 有记录但 chunks 缺失（孤儿向量） */
  orphanVectors: number[];
}

/**
 * 双向 LEFT JOIN 检测 chunks ↔ chunks_vec 的 rowid 一致性。
 * 两个数组都应为空。非空说明对齐被破坏。
 */
export function checkRowidConsistency(
  db: Database.Database,
): RowidConsistencyResult {
  const missingVectors = db.prepare(`
    SELECT c.rowid, c.chunk_id, c.source
    FROM chunks c
    LEFT JOIN chunks_vec v ON v.rowid = c.rowid
    WHERE v.rowid IS NULL
      AND c.source NOT IN ('annotation')
    LIMIT 50
  `).all() as Array<{ rowid: number; chunk_id: string; source: string }>;

  const orphanVectors = db.prepare(`
    SELECT v.rowid
    FROM chunks_vec v
    LEFT JOIN chunks c ON c.rowid = v.rowid
    WHERE c.rowid IS NULL
    LIMIT 50
  `).all() as Array<{ rowid: number }>;

  return {
    missingVectors: missingVectors.map((r) => ({
      rowid: r.rowid,
      chunkId: r.chunk_id,
      source: r.source,
    })),
    orphanVectors: orphanVectors.map((r) => r.rowid),
  };
}

// ─── §10.4 索引统计 ───

export interface ChunkIndexStats {
  source: string;
  chunkCount: number;
  totalTokens: number;
  avgTokens: number;
  minTokens: number;
  maxTokens: number;
}

/**
 * 按 source 分组的 chunk/token 统计——向量索引健康状况概览。
 */
export function getChunkIndexStats(
  db: Database.Database,
): ChunkIndexStats[] {
  const rows = db.prepare(`
    SELECT
      source,
      COUNT(*) AS chunk_count,
      SUM(token_count) AS total_tokens,
      AVG(token_count) AS avg_tokens,
      MIN(token_count) AS min_tokens,
      MAX(token_count) AS max_tokens
    FROM chunks
    GROUP BY source
  `).all() as Array<{
    source: string;
    chunk_count: number;
    total_tokens: number;
    avg_tokens: number;
    min_tokens: number;
    max_tokens: number;
  }>;

  return rows.map((r) => ({
    source: r.source,
    chunkCount: r.chunk_count,
    totalTokens: r.total_tokens,
    avgTokens: Math.round(r.avg_tokens),
    minTokens: r.min_tokens,
    maxTokens: r.max_tokens,
  }));
}
