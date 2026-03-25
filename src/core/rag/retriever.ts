// ═══ 三阶段混合检索管线 ═══
// §3-5: 多路召回 → 精排 → Corrective RAG → 上下文组装

import type Database from 'better-sqlite3';
import type { RankedChunk, ChunkSource, SectionType } from '../types/chunk';
import type { RetrievalRequest, RetrievalResult, RetrievalQualityReport } from '../types/retrieval';
import type { ConceptId, PaperId, MemoId, ChunkId } from '../types/common';
import type { RagConfig } from '../types/config';
import type { DatabaseService } from '../database';
import type { Logger } from '../infra/logger';
import { l2DistanceToScore } from '../infra/vector-math';

import type { Embedder } from './embedder';
import type { Reranker } from './reranker';
import { expandQuery } from './query-intelligence';
import { validateRetrieval, type LlmCallFn } from './corrective-rag';
import { assembleContext } from './context-assembler';

// Fix: CJK 感知 token 估算（中文约 1.5 字符/token，英文约 4 字符/token）
function estimateMemoTokens(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const nonCjk = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + nonCjk / 4);
}

// ─── BM25 词法检索路径（Fix #1a: FTS5） ───

function bm25Recall(
  db: Database.Database,
  queryText: string,
  ftsKeywords: string[],
  topK: number,
  filters: {
    sources?: ChunkSource[] | null;
    paperIds?: PaperId[] | null;
  },
): RankedChunk[] {
  // 构建 FTS5 MATCH 查询
  const terms: string[] = [];

  // 原始 query 中的词（按空格分割，去短词）
  for (const word of queryText.split(/\s+/)) {
    const clean = word.replace(/[^\w]/g, '');
    if (clean.length >= 3) terms.push(`"${clean}"`);
  }

  // 扩展关键词直接用于 FTS
  for (const kw of ftsKeywords) {
    const clean = kw.replace(/[^\w\s-]/g, '');
    if (clean.length >= 2) terms.push(`"${clean}"`);
  }

  if (terms.length === 0) return [];

  // OR 组合
  const matchExpr = terms.join(' OR ');

  const conditions: string[] = [];
  const params: unknown[] = [matchExpr];

  if (filters.sources && filters.sources.length > 0) {
    conditions.push(`c.source IN (${filters.sources.map(() => '?').join(',')})`);
    params.push(...filters.sources);
  }
  if (filters.paperIds && filters.paperIds.length > 0) {
    conditions.push(`c.paper_id IN (${filters.paperIds.map(() => '?').join(',')})`);
    params.push(...filters.paperIds);
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

    return rows.map((row, idx) => ({
      chunkId: row['chunk_id'] as ChunkId,
      paperId: (row['paper_id'] as string | null) as PaperId | null,
      text: row['text'] as string,
      tokenCount: row['token_count'] as number,
      sectionLabel: row['section_label'] as RankedChunk['sectionLabel'],
      sectionTitle: row['section_title'] as string | null,
      sectionType: row['section_type'] as RankedChunk['sectionType'],
      pageStart: row['page_start'] as number | null,
      pageEnd: row['page_end'] as number | null,
      source: row['source'] as ChunkSource,
      positionRatio: row['position_ratio'] as number | null,
      parentChunkId: (row['parent_chunk_id'] as string | null) as ChunkId | null,
      chunkIndex: row['chunk_index'] as number | null,
      contextBefore: row['context_before'] as string | null,
      contextAfter: row['context_after'] as string | null,
      // BM25 score: FTS5 bm25() 返回负数（越小越相关）。
      // 使用 sigmoid 归一化：score = 1 / (1 + e^(bm25/5))，映射到 (0, 1]
      score: (() => {
        const raw = row['bm25_score'];
        if (raw == null || typeof raw !== 'number' || Number.isNaN(raw)) return 0;
        return 1 / (1 + Math.exp(raw / 5));
      })(),
      rawL2Distance: null,
      displayTitle: '',
      originPath: 'structured' as const, // BM25 归为 structured 路径
    }));
  } catch {
    // FTS5 表可能不存在（迁移未执行），静默降级
    return [];
  }
}

// ─── §3.3 向量检索路径 ───

async function vectorRecall(
  db: Database.Database,
  embedder: Embedder,
  queryVariants: string[],
  expandedK: number,
  filters: {
    sources?: ChunkSource[] | null;
    sectionTypes?: SectionType[] | null;
    paperIds?: PaperId[] | null;
  },
): Promise<RankedChunk[]> {
  const allResults = new Map<string, RankedChunk>();

  for (const variant of queryVariants) {
    const queryVec = await embedder.embedSingle(variant);
    const queryBuf = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);

    // 构建动态 WHERE 子句
    const conditions: string[] = [];
    const params: unknown[] = [queryBuf, expandedK];

    if (filters.sources && filters.sources.length > 0) {
      conditions.push(`c.source IN (${filters.sources.map(() => '?').join(',')})`);
      params.push(...filters.sources);
    }
    if (filters.sectionTypes && filters.sectionTypes.length > 0) {
      conditions.push(`c.section_type IN (${filters.sectionTypes.map(() => '?').join(',')})`);
      params.push(...filters.sectionTypes);
    }
    if (filters.paperIds && filters.paperIds.length > 0) {
      conditions.push(`c.paper_id IN (${filters.paperIds.map(() => '?').join(',')})`);
      params.push(...filters.paperIds);
    }

    const whereExtra = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

    const sql = `
      SELECT c.rowid, c.chunk_id, c.paper_id, c.text, c.token_count,
             c.section_label, c.section_title, c.section_type,
             c.page_start, c.page_end, c.source, c.position_ratio,
             c.parent_chunk_id, c.chunk_index,
             c.context_before, c.context_after,
             v.distance
      FROM chunks_vec v
      JOIN chunks c ON c.rowid = v.rowid
      WHERE v.embedding MATCH ?
        AND k = ?
        ${whereExtra}
      ORDER BY v.distance ASC
    `;

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const chunkId = row['chunk_id'] as string;
      const distance = row['distance'] as number;
      const score = l2DistanceToScore(distance);

      // §3.5: 多 query 变体去重，保留最高 score
      const existing = allResults.get(chunkId);
      if (existing && existing.score >= score) continue;

      allResults.set(chunkId, {
        chunkId: chunkId as ChunkId,
        paperId: (row['paper_id'] as string | null) as PaperId | null,
        text: row['text'] as string,
        tokenCount: row['token_count'] as number,
        sectionLabel: row['section_label'] as RankedChunk['sectionLabel'],
        sectionTitle: row['section_title'] as string | null,
        sectionType: row['section_type'] as RankedChunk['sectionType'],
        pageStart: row['page_start'] as number | null,
        pageEnd: row['page_end'] as number | null,
        source: row['source'] as ChunkSource,
        positionRatio: row['position_ratio'] as number | null,
        parentChunkId: (row['parent_chunk_id'] as string | null) as ChunkId | null,
        chunkIndex: row['chunk_index'] as number | null,
        contextBefore: row['context_before'] as string | null,
        contextAfter: row['context_after'] as string | null,
        score,
        rawL2Distance: distance,
        displayTitle: '',
        originPath: 'vector',
      });
    }
  }

  return [...allResults.values()];
}

// ─── §3.4 结构化查询路径 ───

function structuredRecall(
  db: Database.Database,
  request: RetrievalRequest,
): RankedChunk[] {
  const results: RankedChunk[] = [];

  if (request.taskType === 'synthesize' && request.conceptIds.length > 0) {
    // 按概念查询
    const placeholders = request.conceptIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT c.*, p.title AS display_title, pcm.confidence
      FROM paper_concept_map pcm
      JOIN chunks c ON c.paper_id = pcm.paper_id
      JOIN papers p ON p.id = pcm.paper_id
      WHERE pcm.concept_id IN (${placeholders})
        AND pcm.reviewed = 1
        AND pcm.relation != 'irrelevant'
      ORDER BY pcm.confidence DESC
      LIMIT 100
    `).all(...request.conceptIds) as Array<Record<string, unknown>>;

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
        JOIN chunks c ON c.paper_id = pcm.paper_id
        JOIN papers p ON p.id = pcm.paper_id
        WHERE pcm.concept_id IN (${placeholders})
          AND pcm.reviewed = 1
          AND pcm.relation != 'irrelevant'
        GROUP BY c.chunk_id
        HAVING concept_overlap >= 2
        ORDER BY concept_overlap DESC, max_confidence DESC
        LIMIT 50
      `).all(...request.conceptIds) as Array<Record<string, unknown>>;

      for (const row of crossRows) {
        const boosted = Math.min(1.0, (row['max_confidence'] as number) * 1.5);
        results.push(rowToRankedChunk(row, boosted, 'structured'));
      }
    }
  }

  if (request.taskType === 'article' && request.paperIds.length > 0) {
    const placeholders = request.paperIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT c.*, p.title AS display_title
      FROM chunks c
      JOIN papers p ON p.id = c.paper_id
      WHERE c.paper_id IN (${placeholders})
        AND c.source = 'paper'
      ORDER BY c.paper_id, c.position_ratio
      LIMIT 200
    `).all(...request.paperIds) as Array<Record<string, unknown>>;

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

  // 子路径 B: memo 注入
  const memoSet = new Set<string>();

  for (const conceptId of request.conceptIds) {
    const memos = dbService.getMemosByEntity('concept', conceptId);
    for (const memo of memos) {
      if (memoSet.has(String(memo.id))) continue;
      memoSet.add(String(memo.id));
      results.push({
        chunkId: `memo__${memo.id}` as ChunkId,
        paperId: null,
        text: memo.text,
        // Fix: 使用更准确的 token 估算（CJK 字符约 1 token/char）
        tokenCount: estimateMemoTokens(memo.text),
        sectionLabel: null,
        sectionTitle: null,
        sectionType: null,
        pageStart: null,
        pageEnd: null,
        source: 'memo',
        positionRatio: null,
        parentChunkId: null,
        chunkIndex: null,
        contextBefore: null,
        contextAfter: null,
        score: 1.0,
        rawL2Distance: null,
        displayTitle: '研究者笔记',
        originPath: 'memo',
      });
    }
  }

  for (const paperId of request.paperIds) {
    const memos = dbService.getMemosByEntity('paper', paperId);
    for (const memo of memos) {
      if (memoSet.has(String(memo.id))) continue;
      memoSet.add(String(memo.id));
      results.push({
        chunkId: `memo__${memo.id}` as ChunkId,
        paperId: null,
        text: memo.text,
        tokenCount: estimateMemoTokens(memo.text),
        sectionLabel: null,
        sectionTitle: null,
        sectionType: null,
        pageStart: null,
        pageEnd: null,
        source: 'memo',
        positionRatio: null,
        parentChunkId: null,
        chunkIndex: null,
        contextBefore: null,
        contextAfter: null,
        score: 1.0,
        rawL2Distance: null,
        displayTitle: '研究者笔记',
        originPath: 'memo',
      });
    }
  }

  // 显式指定的 memo
  for (const memoId of request.relatedMemoIds) {
    if (memoSet.has(String(memoId))) continue;
    const memo = dbService.getMemo(memoId);
    if (memo) {
      memoSet.add(String(memoId));
      results.push({
        chunkId: `memo__${memo.id}` as ChunkId,
        paperId: null,
        text: memo.text,
        tokenCount: estimateMemoTokens(memo.text),
        sectionLabel: null,
        sectionTitle: null,
        sectionType: null,
        pageStart: null,
        pageEnd: null,
        source: 'memo',
        positionRatio: null,
        parentChunkId: null,
        chunkIndex: null,
        contextBefore: null,
        contextAfter: null,
        score: 1.0,
        rawL2Distance: null,
        displayTitle: '研究者笔记',
        originPath: 'memo',
      });
    }
  }

  return results;
}

// ─── 行映射工具 ───

function rowToRankedChunk(
  row: Record<string, unknown>,
  score: number,
  originPath: RankedChunk['originPath'],
): RankedChunk {
  return {
    chunkId: row['chunk_id'] as ChunkId,
    paperId: (row['paper_id'] as string | null) as PaperId | null,
    text: row['text'] as string,
    tokenCount: row['token_count'] as number,
    sectionLabel: row['section_label'] as RankedChunk['sectionLabel'],
    sectionTitle: row['section_title'] as string | null,
    sectionType: row['section_type'] as RankedChunk['sectionType'],
    pageStart: row['page_start'] as number | null,
    pageEnd: row['page_end'] as number | null,
    source: row['source'] as ChunkSource,
    positionRatio: row['position_ratio'] as number | null,
    parentChunkId: (row['parent_chunk_id'] as string | null) as ChunkId | null,
    chunkIndex: row['chunk_index'] as number | null,
    contextBefore: row['context_before'] as string | null,
    contextAfter: row['context_after'] as string | null,
    score,
    rawL2Distance: null,
    displayTitle: (row['display_title'] as string) ?? '',
    originPath,
  };
}

// ─── §3.3 expandedK 计算 ───

function computeExpandedK(
  request: RetrievalRequest,
  config: RagConfig,
  expandParams: { expandFactorMultiplier: number; topKMultiplier: number },
): number {
  let baseTopK: number;
  switch (request.budgetMode) {
    case 'focused': baseTopK = 10; break;
    case 'broad': baseTopK = 30; break;
    case 'full': baseTopK = 50; break;
  }

  baseTopK = Math.ceil(baseTopK * expandParams.topKMultiplier);
  const expandFactor = config.expandFactor * expandParams.expandFactorMultiplier;

  return Math.ceil(baseTopK * expandFactor);
}

// ─── §4.4 增强 Query 构建 ───

function buildEnhancedQuery(
  request: RetrievalRequest,
  dbService: DatabaseService,
): string {
  if (request.taskType === 'ad_hoc') return request.queryText;

  if (request.taskType === 'synthesize' && request.conceptIds.length > 0) {
    const concept = dbService.getConcept(request.conceptIds[0]!);
    if (concept) {
      return `Evidence for the concept "${concept.nameEn}": ${concept.definition}\nKey terms: ${concept.searchKeywords.join(', ')}`;
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

  const expandedK = computeExpandedK(request, config, expandParams);

  logger.debug('Retrieval started', {
    queryVariants: queryVariants.length,
    expandedK,
    budgetMode: request.budgetMode,
  });

  // §3.2: 四路召回（向量 + BM25 + 结构化 + memo/annotation）
  const [vectorResults, bm25Results, structuredResults, forcedResults] = await Promise.all([
    vectorRecall(db, embedder, queryVariants, expandedK, {
      sources: request.sourceFilter,
      sectionTypes: request.sectionTypeFilter,
      paperIds: request.paperIds.length > 0 ? request.paperIds : null,
    }),
    Promise.resolve(bm25Recall(db, request.queryText, ftsKeywords, expandedK, {
      sources: request.sourceFilter,
      paperIds: request.paperIds.length > 0 ? request.paperIds : null,
    })),
    Promise.resolve(structuredRecall(db, request)),
    Promise.resolve(annotationAndMemoRecall(dbService, request)),
  ]);

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
  const candidates = [...candidateMap.values()].filter((c) => !forcedIds.has(c.chunkId));

  // §4: 精排
  let topK = Math.ceil(
    (request.budgetMode === 'focused' ? 10 : request.budgetMode === 'broad' ? 30 : 50)
    * expandParams.topKMultiplier,
  );

  let reranked: RankedChunk[];
  if (request.skipReranker || candidates.length <= topK) {
    reranked = candidates.sort((a, b) => b.score - a.score).slice(0, topK);
  } else {
    const enhancedQuery = buildEnhancedQuery(request, dbService);
    reranked = await reranker.rerank(enhancedQuery, candidates, topK);
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
    // 快速预判：仅用 Top-3 候选评估，避免全量候选拖慢验证
    const previewCandidates = reranked.slice(0, Math.min(3, reranked.length));
    const preResult = await validateRetrieval(
      previewCandidates,
      request.queryText,
      `${request.taskType} task`,
      llmCall,
      logger,
    );

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
          reranked = candidates.sort((a, b) => b.score - a.score).slice(0, topK);
        }
      } else if (preResult.action === 'rewrite' && preResult.rewrittenQuery) {
        // 仅补充 BM25 召回（轻量），不重跑向量召回（昂贵）
        const bm25Supplement = bm25Recall(db, preResult.rewrittenQuery, ftsKeywords, expandedK, {
          sources: request.sourceFilter,
        });
        for (const c of bm25Supplement) {
          if (!candidateMap.has(c.chunkId)) {
            candidateMap.set(c.chunkId, c);
            candidates.push(c);
          }
        }
        if (!request.skipReranker) {
          const enhancedQuery = buildEnhancedQuery(request, dbService);
          reranked = await reranker.rerank(enhancedQuery, candidates, topK);
        } else {
          reranked = candidates.sort((a, b) => b.score - a.score).slice(0, topK);
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

  logger.info('Retrieval complete', {
    vectorHits: vectorResults.length,
    bm25Hits: bm25Results.length,
    structuredHits: structuredResults.length,
    forcedHits: forced.length,
    finalChunks: assembled.chunks.length,
    totalTokens: assembled.totalTokenCount,
    retryCount: qualityReport.retryCount,
  });

  return {
    chunks: assembled.chunks,
    qualityReport,
    totalTokenCount: assembled.totalTokenCount,
    injectedMemoCount: forced.filter((c) => c.source === 'memo').length,
  };
}
