// ═══ 三阶段混合检索管线 ═══
// §3-5: 多路召回 → 精排 → Corrective RAG → 上下文组装

import type Database from 'better-sqlite3';
import type { RankedChunk, ChunkSource, SectionType } from '../types/chunk';
import type { RetrievalRequest, RetrievalResult, RetrievalQualityReport } from '../types/retrieval';
import type { PaperId } from '../types/common';
import type { RagConfig } from '../types/config';
import type { DatabaseService } from '../database';
import type { Logger } from '../infra/logger';
import { l2DistanceToScore, l2Distance } from '../infra/vector-math';
import type { Embedder } from './embedder';
import type { Reranker } from './reranker';
import { expandQuery } from './query-intelligence';
import { validateRetrieval, type LlmCallFn } from './corrective-rag';
import { assembleContext } from './context-assembler';
import { rowToRankedChunk, memoToRankedChunk, mergeVectorRows } from './chunk-mappers';
import { hasLayoutColumns } from '../database/prepared-statements';

// ─── 稳定排序工具（score 降序 + chunkId 字典序 tiebreaker） ───

function stableScoreSort(chunks: RankedChunk[]): RankedChunk[] {
  return chunks.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });
}

// ─── BM25 词法检索路径（Fix #1a: FTS5） ───

interface Bm25Result {
  chunks: RankedChunk[];
  /** Fix #6: FTS5 表是否可用 */
  available: boolean;
}

function bm25Recall(
  db: Database.Database,
  queryText: string,
  ftsKeywords: string[],
  topK: number,
  filters: {
    sources?: ChunkSource[] | null;
    paperIds?: PaperId[] | null;
  },
): Bm25Result {
  // 构建 FTS5 MATCH 查询
  const terms: string[] = [];

  // 原始 query 中的词（按空格分割，去短词）
  for (const word of queryText.split(/\s+/)) {
    const clean = word.replace(/[^\w]/g, '');
    if (clean.length >= 3) terms.push(`"${clean}"`);
  }

  // CJK 处理：从 query 中提取连续 CJK 字符段作为 FTS5 term
  // FTS5 的默认 tokenizer 对 CJK 按字符分割，直接引号包裹 CJK 短语可匹配
  const cjkPhrases = queryText.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g);
  if (cjkPhrases) {
    for (const phrase of cjkPhrases) {
      // 对长 CJK 短语按 2-4 字符滑动窗口拆分为多个 term
      if (phrase.length <= 4) {
        terms.push(`"${phrase}"`);
      } else {
        for (let i = 0; i <= phrase.length - 2; i += 2) {
          const gram = phrase.slice(i, i + Math.min(4, phrase.length - i));
          if (gram.length >= 2) terms.push(`"${gram}"`);
        }
      }
    }
  }

  // 扩展关键词直接用于 FTS
  for (const kw of ftsKeywords) {
    const clean = kw.replace(/[^\w\s-]/g, '');
    if (clean.length >= 2) terms.push(`"${clean}"`);
  }

  if (terms.length === 0) return { chunks: [], available: true };

  // OR 组合（去重）
  const uniqueTerms = [...new Set(terms)];
  const matchExpr = uniqueTerms.join(' OR ');

  const conditions: string[] = [];
  const params: unknown[] = [matchExpr];

  if (filters.sources && filters.sources.length > 0) {
    conditions.push(`c.source IN (${filters.sources.map(() => '?').join(',')})`);
    params.push(...filters.sources);
  }
  if (filters.paperIds && filters.paperIds.length > 0) {
    // Fix #2: 使用 json_each 防止 SQLite 参数上限（与向量路径一致）
    conditions.push(`c.paper_id IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(filters.paperIds));
  }

  const whereExtra = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  try {
    const sql = `
      SELECT c.*, bm25(chunks_fts) AS bm25_score
      FROM chunks_fts fts
      JOIN chunks c ON c.rowid = fts.rowid
      WHERE chunks_fts MATCH ?
        ${whereExtra}
      ORDER BY bm25_score ASC
      LIMIT ?
    `;
    params.push(topK);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const chunks = rows.map((row) => {
      // BM25 score: FTS5 bm25() 返回负数（越小越相关）。
      // 使用 sigmoid 归一化：score = 1 / (1 + e^(bm25/5))，映射到 (0, 1]
      const raw = row['bm25_score'];
      const score = (raw == null || typeof raw !== 'number' || Number.isNaN(raw))
        ? 0
        : 1 / (1 + Math.exp(raw / 5));
      return rowToRankedChunk(row, score, 'structured');
    });
    return { chunks, available: true };
  } catch {
    // Fix #6: FTS5 表可能不存在（迁移未执行），标记为不可用
    return { chunks: [], available: false };
  }
}

// ─── §3.3 向量检索路径 ───

/**
 * Fix #1: 高选择性过滤的候选集大小阈值。
 * 当 paperIds 过滤限定的候选 chunk 数 < 此值时，
 * 切换到应用层内存 KNN（从 DB 读取候选 embedding 后在 V8 中计算距离）。
 * 200 个向量的内存距离计算耗时 < 1ms，远比 KNN 后置过滤可靠。
 */
const IN_MEMORY_KNN_THRESHOLD = 1000;

async function vectorRecall(
  db: Database.Database,
  embedder: Embedder,
  queryVariants: string[],
  expandedK: number,
  filters: {
    sources?: ChunkSource[] | null;
    sectionTypes?: SectionType[] | null;
    paperIds?: PaperId[] | null;
    blockTypes?: string[] | null;
  },
): Promise<RankedChunk[]> {
  // Fix #1: 策略分流——当 paperIds 过滤限定的候选集极小时，
  // 切换到应用层内存 KNN，避免 sqlite-vec 后置过滤的召回坍塌。
  if (filters.paperIds && filters.paperIds.length > 0) {
    const candidateCount = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM chunks c
       JOIN json_each(?) jp ON c.paper_id = jp.value`,
    ).get(JSON.stringify(filters.paperIds)) as { cnt: number }).cnt;

    if (candidateCount < IN_MEMORY_KNN_THRESHOLD) {
      return inMemoryVectorRecall(db, embedder, queryVariants, expandedK, filters);
    }
  }

  return sqliteVecRecall(db, embedder, queryVariants, expandedK, filters);
}

/**
 * 标准路径：sqlite-vec KNN + 后置过滤。
 * Fix #2: paperIds/sectionTypes 使用 json_each 替代 IN (?,?,...) 防止参数上限。
 */
async function sqliteVecRecall(
  db: Database.Database,
  embedder: Embedder,
  queryVariants: string[],
  expandedK: number,
  filters: {
    sources?: ChunkSource[] | null;
    sectionTypes?: SectionType[] | null;
    paperIds?: PaperId[] | null;
    blockTypes?: string[] | null;
  },
): Promise<RankedChunk[]> {
  const allResults = new Map<string, RankedChunk>();
  const variantHitCounts = new Map<string, number>();

  for (const variant of queryVariants) {
    const queryVec = await embedder.embedSingle(variant);
    const queryBuf = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);

    // 构建动态 WHERE 子句
    // Fix #2: 短数组用 IN (?,...) ，长数组用 json_each(?) 防止参数上限
    const conditions: string[] = [];
    const params: unknown[] = [queryBuf, expandedK];

    if (filters.sources && filters.sources.length > 0) {
      // source 枚举最多 6 个值，安全使用 IN
      conditions.push(`c.source IN (${filters.sources.map(() => '?').join(',')})`);
      params.push(...filters.sources);
    }
    if (filters.sectionTypes && filters.sectionTypes.length > 0) {
      // sectionType 枚举最多 7 个值，安全使用 IN
      conditions.push(`c.section_type IN (${filters.sectionTypes.map(() => '?').join(',')})`);
      params.push(...filters.sectionTypes);
    }
    if (filters.paperIds && filters.paperIds.length > 0) {
      // paperIds 可能有数百个，使用 json_each 避免参数上限
      conditions.push(`c.paper_id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filters.paperIds));
    }
    const withLayout = hasLayoutColumns(db);
    if (withLayout && filters.blockTypes && filters.blockTypes.length > 0) {
      conditions.push(`c.block_type IN (${filters.blockTypes.map(() => '?').join(',')})`);
      params.push(...filters.blockTypes);
    }

    const whereExtra = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';
    const layoutCols = withLayout ? ', c.block_type, c.reading_order, c.column_layout' : '';

    const sql = `
      SELECT c.rowid, c.chunk_id, c.paper_id, c.text, c.token_count,
             c.section_label, c.section_title, c.section_type,
             c.page_start, c.page_end, c.source, c.position_ratio,
             c.parent_chunk_id, c.chunk_index,
             c.context_before, c.context_after${layoutCols},
             v.distance
      FROM chunks_vec v
      JOIN chunks c ON c.rowid = v.rowid
      WHERE v.embedding MATCH ?
        AND k = ?
        ${whereExtra}
      ORDER BY v.distance ASC
    `;

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    mergeVectorRows(rows, allResults, variantHitCounts);
  }

  return [...allResults.values()];
}

/**
 * Fix #1: 应用层内存 KNN 回退路径。
 *
 * 当候选集极小（< 1000 chunk）时，从 DB 读取候选向量到内存，
 * 在 V8 中计算 L2 距离并排序——100% 召回率，无后置过滤损耗。
 * 200 个 1536 维向量的距离计算耗时 < 1ms。
 */
async function inMemoryVectorRecall(
  db: Database.Database,
  embedder: Embedder,
  queryVariants: string[],
  expandedK: number,
  filters: {
    sources?: ChunkSource[] | null;
    sectionTypes?: SectionType[] | null;
    paperIds?: PaperId[] | null;
    blockTypes?: string[] | null;
  },
): Promise<RankedChunk[]> {
  // 构建候选集 SQL（不走 chunks_vec 虚拟表，直接读 embedding blob）
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.paperIds && filters.paperIds.length > 0) {
    conditions.push(`c.paper_id IN (SELECT value FROM json_each(?))`);
    params.push(JSON.stringify(filters.paperIds));
  }
  if (filters.sources && filters.sources.length > 0) {
    conditions.push(`c.source IN (${filters.sources.map(() => '?').join(',')})`);
    params.push(...filters.sources);
  }
  if (filters.sectionTypes && filters.sectionTypes.length > 0) {
    conditions.push(`c.section_type IN (${filters.sectionTypes.map(() => '?').join(',')})`);
    params.push(...filters.sectionTypes);
  }
  const withLayout = hasLayoutColumns(db);
  if (withLayout && filters.blockTypes && filters.blockTypes.length > 0) {
    conditions.push(`c.block_type IN (${filters.blockTypes.map(() => '?').join(',')})`);
    params.push(...filters.blockTypes);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // 读取候选 chunk 元数据 + embedding blob
  const candidateRows = db.prepare(`
    SELECT c.rowid, c.chunk_id, c.paper_id, c.text, c.token_count,
           c.section_label, c.section_title, c.section_type,
           c.page_start, c.page_end, c.source, c.position_ratio,
           c.parent_chunk_id, c.chunk_index,
           c.context_before, c.context_after,
           v.embedding
    FROM chunks c
    JOIN chunks_vec v ON v.rowid = c.rowid
    ${whereClause}
  `).all(...params) as Array<Record<string, unknown>>;

  const allResults = new Map<string, RankedChunk>();

  for (const variant of queryVariants) {
    const queryVec = await embedder.embedSingle(variant);

    // 计算每个候选的 L2 距离并排序
    const scored = candidateRows.map((row) => {
      const embBuf = row['embedding'] as Buffer;
      const embVec = new Float32Array(
        embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4,
      );
      const distance = l2Distance(queryVec, embVec);
      return { row, distance };
    });

    scored.sort((a, b) => a.distance - b.distance);

    // 取 top expandedK
    for (const { row, distance } of scored.slice(0, expandedK)) {
      const chunkId = row['chunk_id'] as string;
      const score = l2DistanceToScore(distance);

      const existing = allResults.get(chunkId);
      if (existing && existing.score >= score) continue;

      allResults.set(chunkId, rowToRankedChunk(row, score, 'vector', { rawL2Distance: distance }));
    }
  }

  return [...allResults.values()];
}

// mergeVectorRows — imported from ./chunk-mappers

// ─── §3.4 结构化查询路径 ───

function structuredRecall(
  db: Database.Database,
  request: RetrievalRequest,
  config: RagConfig,
): RankedChunk[] {
  const results: RankedChunk[] = [];

  // Fix #2: 使用 json_each(?) 替代 IN (?,?,...) 防止 SQLite 参数上限
  if (request.taskType === 'synthesize' && request.conceptIds.length > 0) {
    const conceptsJson = JSON.stringify(request.conceptIds);
    const rows = db.prepare(`
      SELECT c.*, p.title AS display_title, pcm.confidence
      FROM paper_concept_map pcm
      JOIN json_each(?) jc ON pcm.concept_id = jc.value
      JOIN chunks c ON c.paper_id = pcm.paper_id
      JOIN papers p ON p.id = pcm.paper_id
      WHERE pcm.reviewed = 1
        AND pcm.relation != 'irrelevant'
      ORDER BY pcm.confidence DESC
      LIMIT 100
    `).all(conceptsJson) as Array<Record<string, unknown>>;

    for (const row of rows) {
      results.push(rowToRankedChunk(row, row['confidence'] as number, 'structured'));
    }

    // 跨概念交叉论文（§3.4）
    if (request.conceptIds.length >= 2) {
      const crossRows = db.prepare(`
        SELECT c.*, p.title AS display_title,
               COUNT(DISTINCT pcm.concept_id) AS concept_overlap,
               MAX(pcm.confidence) AS max_confidence
        FROM paper_concept_map pcm
        JOIN json_each(?) jc ON pcm.concept_id = jc.value
        JOIN chunks c ON c.paper_id = pcm.paper_id
        JOIN papers p ON p.id = pcm.paper_id
        WHERE pcm.reviewed = 1
          AND pcm.relation != 'irrelevant'
        GROUP BY c.chunk_id
        HAVING concept_overlap >= 2
        ORDER BY concept_overlap DESC, max_confidence DESC
        LIMIT 50
      `).all(conceptsJson) as Array<Record<string, unknown>>;

      for (const row of crossRows) {
        const boostFactor = config.crossConceptBoostFactor;
        const boosted = Math.min(1.0, (row['max_confidence'] as number) * boostFactor);
        results.push(rowToRankedChunk(row, boosted, 'structured'));
      }
    }
  }

  if (request.taskType === 'article' && request.paperIds.length > 0) {
    const papersJson = JSON.stringify(request.paperIds);
    const rows = db.prepare(`
      SELECT c.*, p.title AS display_title
      FROM chunks c
      JOIN papers p ON p.id = c.paper_id
      JOIN json_each(?) jp ON c.paper_id = jp.value
      WHERE c.source = 'paper'
      ORDER BY c.paper_id, c.position_ratio
      LIMIT 200
    `).all(papersJson) as Array<Record<string, unknown>>;

    for (const row of rows) {
      results.push(rowToRankedChunk(row, 1.0, 'structured'));
    }
  }

  return results;
}

// ─── §3.5 标注 + memo 优先路径 ───

function annotationAndMemoRecall(
  dbService: DatabaseService,
  request: RetrievalRequest,
): RankedChunk[] {
  const results: RankedChunk[] = [];
  const memoSet = new Set<string>();

  const pushMemo = (memo: { id: unknown; text: string }) => {
    const key = String(memo.id);
    if (memoSet.has(key)) return;
    memoSet.add(key);
    results.push(memoToRankedChunk(memo as any));
  };

  for (const conceptId of request.conceptIds) {
    for (const memo of dbService.getMemosByEntity('concept', conceptId)) {
      pushMemo(memo);
    }
  }

  for (const paperId of request.paperIds) {
    for (const memo of dbService.getMemosByEntity('paper', paperId)) {
      pushMemo(memo);
    }
  }

  for (const memoId of request.relatedMemoIds) {
    if (memoSet.has(String(memoId))) continue;
    const memo = dbService.getMemo(memoId);
    if (memo) {
      pushMemo(memo);
    }
  }

  return results;
}

// ─── §3.3 expandedK 计算 ───

function computeExpandedK(
  request: RetrievalRequest,
  config: RagConfig,
  expandParams: { expandFactorMultiplier: number; topKMultiplier: number },
  db?: Database.Database,
): number {
  // Fix #1: 优先使用 adapter 层 budget-calculator 推导的 topK
  let baseTopK: number;
  if (request.topK != null && request.topK > 0) {
    baseTopK = request.topK;
  } else {
    switch (request.budgetMode) {
      case 'focused': baseTopK = 10; break;
      case 'broad': baseTopK = 30; break;
      case 'full': baseTopK = 50; break;
    }
  }

  baseTopK = Math.ceil(baseTopK * expandParams.topKMultiplier);
  let expandFactor = config.expandFactor * expandParams.expandFactorMultiplier;

  // §5.3 动态 expandFactor：多条件组合 R 建模
  // R = 各过滤条件选择率的乘积，expandFactor = ceil(1/R)，上限 10
  if (db) {
    let R = 1.0;
    let hasFilters = false;

    if (request.paperIds && request.paperIds.length > 0) {
      const totalPapers = (
        db.prepare('SELECT COUNT(*) AS cnt FROM papers').get() as { cnt: number }
      ).cnt;
      if (totalPapers > 0) {
        R *= request.paperIds.length / totalPapers;
        hasFilters = true;
      }
    }

    if (request.sectionTypeFilter && request.sectionTypeFilter.length > 0) {
      // sectionType 总共约 7 种，估算选择率
      const totalTypes = 7;
      R *= request.sectionTypeFilter.length / totalTypes;
      hasFilters = true;
    }

    if (request.sourceFilter && request.sourceFilter.length > 0) {
      // source 总共约 6 种
      const totalSources = 6;
      R *= request.sourceFilter.length / totalSources;
      hasFilters = true;
    }

    if (hasFilters && R > 0) {
      const dynamicFactor = Math.ceil(1 / R);
      expandFactor = Math.max(expandFactor, dynamicFactor);
      expandFactor = Math.min(expandFactor, 10);
    }
  }

  return Math.ceil(baseTopK * expandFactor);
}

// ─── §4.4 增强 Query 构建 ───

function buildEnhancedQuery(
  request: RetrievalRequest,
  dbService: DatabaseService,
): string {
  if (request.taskType === 'ad_hoc') return request.queryText;

  if (request.taskType === 'synthesize' && request.conceptIds.length > 0) {
    // Build multi-concept query — primary concept gets full detail, secondary concepts
    // get abbreviated context. Uses natural language instead of synthetic weight tokens
    // that confuse cross-encoder rerankers.
    const parts: string[] = [];
    for (let i = 0; i < request.conceptIds.length; i++) {
      const concept = dbService.getConcept(request.conceptIds[i]!);
      if (!concept) continue;
      if (i === 0) {
        parts.push(`Evidence for the concept "${concept.nameEn}": ${concept.definition}\nKey terms: ${concept.searchKeywords.join(', ')}`);
      } else {
        parts.push(`Also relevant: "${concept.nameEn}" (${concept.definition.slice(0, 100)})`);
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }

  return request.queryText;
}

// ═══ retrieve 主函数 ═══

export async function retrieve(
  request: RetrievalRequest,
  embedder: Embedder,
  reranker: Reranker,
  dbService: DatabaseService,
  config: RagConfig,
  logger: Logger,
  llmCall?: LlmCallFn | undefined,
): Promise<RetrievalResult> {
  const db = dbService.raw;

  // §6: Query Intelligence
  let queryVariants: string[];
  let ftsKeywords: string[] = [];
  let expandParams = { expandFactorMultiplier: 1, topKMultiplier: 1 };

  if (request.skipQueryExpansion) {
    queryVariants = [request.queryText];
  } else {
    const expanded = expandQuery(request.queryText, request.conceptIds, dbService);
    queryVariants = expanded.variants;
    ftsKeywords = expanded.ftsKeywords;
    expandParams = expanded.expandParams;
  }

  const expandedK = computeExpandedK(request, config, expandParams, db);

  const retrievalStartMs = Date.now();
  logger.info('[Retriever] Retrieval started', {
    taskType: request.taskType,
    queryVariants: queryVariants.length,
    expandedK,
    budgetMode: request.budgetMode,
    paperIds: request.paperIds.length,
    conceptIds: request.conceptIds.length,
    blockTypeFilter: request.blockTypeFilter ?? null,
    queryPreview: request.queryText.slice(0, 80),
  });

  // §3.2: 四路召回（向量 + BM25 + 结构化 + memo/annotation）
  const vecStartMs = Date.now();
  const [vectorResults, bm25Result, structuredResults, forcedResults] = await Promise.all([
    vectorRecall(db, embedder, queryVariants, expandedK, {
      sources: request.sourceFilter,
      sectionTypes: request.sectionTypeFilter,
      paperIds: request.paperIds.length > 0 ? request.paperIds : null,
      blockTypes: request.blockTypeFilter ?? null,
    }),
    Promise.resolve(bm25Recall(db, request.queryText, ftsKeywords, expandedK, {
      sources: request.sourceFilter,
      paperIds: request.paperIds.length > 0 ? request.paperIds : null,
    })),
    Promise.resolve(structuredRecall(db, request, config)),
    Promise.resolve(annotationAndMemoRecall(dbService, request)),
  ]);
  const recallDurationMs = Date.now() - vecStartMs;

  const bm25Results = bm25Result.chunks;
  const bm25Available = bm25Result.available;

  logger.info('[Retriever] Four-way recall complete', {
    vectorHits: vectorResults.length,
    bm25Hits: bm25Results.length,
    bm25Available,
    structuredHits: structuredResults.length,
    forcedHits: forcedResults.length,
    recallDurationMs,
  });

  // Fix #6: 标记 BM25 不可用
  if (!bm25Available) {
    logger.warn('[Retriever] BM25 channel unavailable (FTS5 table missing). Hybrid retrieval degraded to vector-only.');
  }

  // §3.6: 合并去重
  const candidateMap = new Map<string, RankedChunk>();
  const forced: RankedChunk[] = [];

  // Fix: 去重 forced chunks（同一 memo/annotation 可能被多个概念/论文触发）
  const forcedDedup = new Set<string>();
  for (const chunk of forcedResults) {
    if (forcedDedup.has(chunk.chunkId)) continue;
    forcedDedup.add(chunk.chunkId);
    forced.push(chunk);
  }

  for (const chunk of [...vectorResults, ...bm25Results, ...structuredResults]) {
    const existing = candidateMap.get(chunk.chunkId);
    if (!existing || chunk.score > existing.score) {
      candidateMap.set(chunk.chunkId, chunk);
    }
  }

  // 移除 forced 中已有的 chunk
  const forcedIds = new Set(forced.map((c) => c.chunkId));
  let candidates = [...candidateMap.values()].filter((c) => !forcedIds.has(c.chunkId));

  // §4: 精排
  // Fix #1: 优先使用 adapter 层推导的 topK
  const baseRerankTopK = (request.topK != null && request.topK > 0)
    ? request.topK
    : (request.budgetMode === 'focused' ? 10 : request.budgetMode === 'broad' ? 30 : 50);
  let topK = Math.ceil(baseRerankTopK * expandParams.topKMultiplier);

  const rerankStartMs = Date.now();
  let reranked: RankedChunk[];
  if (request.skipReranker || candidates.length <= topK) {
    reranked = stableScoreSort(candidates).slice(0, topK);
    logger.debug('[Retriever] Rerank skipped (score sort)', { candidates: candidates.length, topK });
  } else {
    const enhancedQuery = buildEnhancedQuery(request, dbService);
    reranked = await reranker.rerank(enhancedQuery, candidates, topK);
    logger.info('[Retriever] Rerank complete', {
      candidatesIn: candidates.length,
      topK,
      rerankOut: reranked.length,
      durationMs: Date.now() - rerankStartMs,
    });
  }

  // §7: Corrective RAG（Fix #3: 快速预判，避免重试风暴）
  // 改进：先用 Top-3 候选做轻量级预判（Fail-Fast），仅在预判不通过时才触发单次补救
  let qualityReport: RetrievalQualityReport = {
    coverage: 'sufficient',
    retryCount: 0,
    gaps: [],
  };

  if (
    request.enableCorrectiveRag &&
    config.correctiveRagEnabled &&
    llmCall &&
    request.budgetMode !== 'full'
  ) {
    // 快速预判：用 Top-5 候选评估（从 3 扩大到 5 以提高 gap 检测准确度）
    const previewCandidates = reranked.slice(0, Math.min(5, reranked.length));
    const preResult = await validateRetrieval(
      previewCandidates,
      request.queryText,
      `${request.taskType} task`,
      llmCall,
      logger,
    );

    logger.info('[Retriever] Corrective RAG pre-check', {
      action: preResult.action,
      coverage: preResult.coverage,
      gaps: preResult.gaps.length,
    });

    if (preResult.action !== 'pass') {
      // 单次补救（不循环重试，避免延迟雪崩）
      qualityReport = {
        coverage: preResult.coverage,
        retryCount: 1,
        gaps: preResult.gaps,
      };

      if (preResult.action === 'filter' && preResult.removeIndices.length > 0) {
        const removeSet = new Set(preResult.removeIndices);
        reranked = reranked.filter((_, i) => !removeSet.has(i));
      } else if (preResult.action === 'expand') {
        // 扩大 topK 后仅在已有候选池中重排（不重跑向量召回）
        topK = Math.ceil(topK * 1.5);
        if (!request.skipReranker && candidates.length > topK) {
          const enhancedQuery = buildEnhancedQuery(request, dbService);
          reranked = await reranker.rerank(enhancedQuery, candidates, topK);
        } else {
          reranked = stableScoreSort(candidates).slice(0, topK);
        }
      } else if (preResult.action === 'rewrite' && preResult.rewrittenQuery) {
        // 仅补充 BM25 召回（轻量），不重跑向量召回（昂贵）
        const bm25Supplement = bm25Recall(db, preResult.rewrittenQuery, ftsKeywords, expandedK, {
          sources: request.sourceFilter,
        }).chunks;
        const supplementChunks: RankedChunk[] = [];
        for (const c of bm25Supplement) {
          if (!candidateMap.has(c.chunkId)) {
            candidateMap.set(c.chunkId, c);
            supplementChunks.push(c);
          }
        }
        // 不可变扩展：创建新数组而非直接 mutate
        candidates = [...candidates, ...supplementChunks];
        if (!request.skipReranker) {
          const enhancedQuery = buildEnhancedQuery(request, dbService);
          reranked = await reranker.rerank(enhancedQuery, candidates, topK);
        } else {
          reranked = stableScoreSort(candidates).slice(0, topK);
        }
      }
    }
  }

  // §5: 上下文组装
  const assembled = assembleContext(
    reranked,
    forced,
    request.maxTokens,
    request.budgetMode,
  );

  logger.info('[Retriever] Retrieval complete', {
    vectorHits: vectorResults.length,
    bm25Hits: bm25Results.length,
    bm25Available,
    structuredHits: structuredResults.length,
    forcedHits: forced.length,
    candidatesAfterDedup: candidateMap.size,
    finalChunks: assembled.chunks.length,
    totalTokens: assembled.totalTokenCount,
    retryCount: qualityReport.retryCount,
    totalDurationMs: Date.now() - retrievalStartMs,
  });

  return {
    chunks: assembled.chunks,
    qualityReport,
    totalTokenCount: assembled.totalTokenCount,
    injectedMemoCount: forced.filter((c) => c.source === 'memo').length,
    bm25Available,
  };
}
