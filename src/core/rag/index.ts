// ═══ RAG Module — 公共接口 ═══
//
// 检索核心：嵌入生成 + chunk 索引 + 三阶段混合检索 + Corrective RAG + 上下文组装

import type { AbyssalConfig } from '../types/config';
import type { EmbedFunction, PaperId, ConceptId, ChunkId } from '../types/common';
import type { TextChunk, RankedChunk, ChunkSource, SectionType } from '../types/chunk';
import type { RetrievalRequest, RetrievalResult, ContextBudgetMode } from '../types/retrieval';
import type { Relevance } from '../types/paper';
import type { Logger } from '../infra/logger';
import type { DatabaseService } from '../database';
import { l2DistanceToScore } from '../infra/vector-math';
import { countTokens } from '../infra/token-counter';
import * as vectorDiagnostics from '../database/vector-diagnostics';

import { Embedder } from './embedder';
import { Reranker, type RerankFunction } from './reranker';
import { indexChunks, type IndexResult } from './indexer';
import { retrieve } from './retriever';
import type { LlmCallFn } from './corrective-rag';

// ─── 类型重导出 ───

export type { IndexResult } from './indexer';
export type { LlmCallFn } from './corrective-rag';
export type { RerankFunction } from './reranker';
export type { QueryExpansionResult } from './query-intelligence';
export { Embedder } from './embedder';
export { Reranker } from './reranker';
export { expandQuery, expandQueryHierarchical } from './query-intelligence';
export { assembleContext } from './context-assembler';

// ─── §8.1 MetadataFilters ───

export interface MetadataFilters {
  paperIds?: PaperId[] | null | undefined;
  sources?: ChunkSource[] | null | undefined;
  sectionTypes?: SectionType[] | null | undefined;
  yearRange?: { min?: number | undefined; max?: number | undefined } | null | undefined;
  relevance?: Relevance[] | null | undefined;
}

// ═══ RagService ═══

export class RagService {
  private readonly embedder: Embedder;
  private readonly reranker: Reranker;
  private readonly dbService: DatabaseService;
  private readonly config: AbyssalConfig;
  private readonly logger: Logger;
  private readonly llmCall: LlmCallFn | null;

  constructor(
    embedFn: EmbedFunction,
    dbService: DatabaseService,
    config: AbyssalConfig,
    logger: Logger,
    options?: {
      rerankFn?: RerankFunction | null | undefined;
      llmCall?: LlmCallFn | null | undefined;
    },
  ) {
    this.dbService = dbService;
    this.config = config;
    this.logger = logger;
    this.llmCall = options?.llmCall ?? null;

    this.embedder = new Embedder(embedFn, config.rag, logger);
    this.reranker = new Reranker(
      config.rag,
      {
        cohereApiKey: config.apiKeys.cohereApiKey ?? null,
        jinaApiKey: config.apiKeys.jinaApiKey ?? null,
      },
      logger,
      options?.rerankFn,
    );
  }

  /** 获取 Embedder 实例（供外部调用） */
  getEmbedder(): Embedder {
    return this.embedder;
  }

  // ════════════════════════════════════════
  // §2 索引
  // ════════════════════════════════════════

  async indexChunks(
    chunks: TextChunk[],
    embeddings: Float32Array[],
  ): Promise<IndexResult> {
    return indexChunks(
      chunks,
      embeddings,
      this.dbService,
      this.logger,
      this.config.rag.embeddingBackend === 'api',
    );
  }

  // ════════════════════════════════════════
  // §3-5 三阶段检索
  // ════════════════════════════════════════

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    return retrieve(
      request,
      this.embedder,
      this.reranker,
      this.dbService,
      this.config.rag,
      this.logger,
      this.llmCall ?? undefined,
    );
  }

  // ════════════════════════════════════════
  // §8 独立检索函数
  // ════════════════════════════════════════

  /** §8.1 纯向量检索 */
  async searchSemantic(
    queryText: string,
    topK: number = 10,
    filters: MetadataFilters = {},
  ): Promise<RankedChunk[]> {
    const queryVec = await this.embedder.embedSingle(queryText);
    const queryBuf = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);
    const db = this.dbService.raw;

    const expandedK = topK * (this.config.rag.expandFactor || 3);

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

    const rows = db.prepare(`
      SELECT c.*, v.distance
      FROM chunks_vec v
      JOIN chunks c ON c.rowid = v.rowid
      WHERE v.embedding MATCH ? AND k = ?
        ${whereExtra}
      ORDER BY v.distance ASC
    `).all(...params) as Array<Record<string, unknown>>;

    return rows.slice(0, topK).map((row) => ({
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
      score: l2DistanceToScore(row['distance'] as number),
      rawL2Distance: row['distance'] as number,
      displayTitle: '',
      originPath: 'vector' as const,
    }));
  }

  /** §8.2 按概念检索 */
  async searchByConcept(
    conceptId: ConceptId,
    topK: number = 10,
  ): Promise<RankedChunk[]> {
    const concept = this.dbService.getConcept(conceptId);
    if (!concept) return [];

    // 精确映射路径
    const mappings = this.dbService.getMappingsByConcept(conceptId);
    const mappedChunks: RankedChunk[] = [];

    for (const m of mappings.slice(0, topK)) {
      const chunks = this.dbService.getChunksByPaper(m.paperId);
      for (const c of chunks.slice(0, 3)) {
        mappedChunks.push({
          ...c,
          score: Math.min(1.0, m.confidence * 1.5),
          rawL2Distance: null,
          displayTitle: '',
          originPath: 'structured',
        });
      }
    }

    // 向量路径
    const queryText = `${concept.definition} ${concept.searchKeywords.join(' ')}`;
    const vectorResults = await this.searchSemantic(queryText, topK);

    // memo/note 路径
    const memos = this.dbService.getMemosByEntity('concept', conceptId);
    const memoChunks: RankedChunk[] = memos.slice(0, 5).map((m) => ({
      chunkId: `memo__${m.id}` as ChunkId,
      paperId: null,
      text: m.text,
      tokenCount: Math.ceil(m.text.length / 4),
      sectionLabel: null,
      sectionTitle: null,
      sectionType: null,
      pageStart: null,
      pageEnd: null,
      source: 'memo' as const,
      positionRatio: null,
      parentChunkId: null,
      chunkIndex: null,
      contextBefore: null,
      contextAfter: null,
      score: 0.9,
      rawL2Distance: null,
      displayTitle: '研究者笔记',
      originPath: 'memo' as const,
    }));

    // 合并去重
    const seen = new Set<string>();
    const all: RankedChunk[] = [];
    for (const chunk of [...mappedChunks, ...vectorResults, ...memoChunks]) {
      if (!seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        all.push(chunk);
      }
    }

    return all.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** §8.3 搜索相似论文 */
  async searchSimilar(
    paperId: PaperId,
    topK: number = 10,
  ): Promise<RankedChunk[]> {
    const chunks = this.dbService.getChunksByPaper(paperId);
    const abstractChunk = chunks.find((c) => c.sectionLabel === 'abstract') ?? chunks[0];
    if (!abstractChunk) return [];

    const results = await this.searchSemantic(abstractChunk.text, topK * 3, {
      sources: ['paper'],
    });

    // 排除自身论文 + 按 paper_id 去重
    const seen = new Set<string>();
    const filtered: RankedChunk[] = [];
    for (const r of results) {
      if (r.paperId === paperId) continue;
      if (r.paperId && seen.has(r.paperId)) continue;
      if (r.paperId) seen.add(r.paperId);
      filtered.push(r);
      if (filtered.length >= topK) break;
    }

    return filtered;
  }

  /**
   * §3.6 Template E: 纲要节引用论文直接查询。
   *
   * 按纲要的引用论文列表拉取 chunk——不经过向量或概念映射。
   * score 固定 1.0——研究者在纲要中明确指定的论文具有最高优先级。
   *
   * TODO: 与 article 工作流的 Orchestrator 集成
   */
  searchByOutlinePapers(
    paperIds: PaperId[],
    sectionTypes?: SectionType[] | null,
  ): RankedChunk[] {
    if (paperIds.length === 0) return [];
    const db = this.dbService.raw;

    const paperPlaceholders = paperIds.map(() => '?').join(',');
    const params: unknown[] = [...paperIds];

    let sectionFilter = '';
    if (sectionTypes && sectionTypes.length > 0) {
      sectionFilter = `AND c.section_type IN (${sectionTypes.map(() => '?').join(',')})`;
      params.push(...sectionTypes);
    }

    const rows = db.prepare(`
      SELECT c.*, p.title AS paper_title, p.year AS paper_year
      FROM chunks c
      JOIN papers p ON p.id = c.paper_id
      WHERE c.paper_id IN (${paperPlaceholders})
        AND c.source = 'paper'
        ${sectionFilter}
      ORDER BY c.paper_id, c.position_ratio ASC
    `).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      chunkId: row['chunk_id'] as ChunkId,
      paperId: (row['paper_id'] as string) as PaperId,
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
      score: 1.0,
      rawL2Distance: null,
      displayTitle: (row['paper_title'] as string) ?? '',
      originPath: 'structured' as const,
    }));
  }

  /** §8.4 索引统计（含 §10 诊断） */
  getIndexStats(): {
    totalChunks: number;
    totalTokens: number;
    bySource: Record<string, number>;
    embeddingDimension: number;
    embeddingModel: string;
  } {
    const stats = this.dbService.getStats();
    const indexStats = vectorDiagnostics.getChunkIndexStats(this.dbService.raw);
    const totalTokens = indexStats.reduce((sum, s) => sum + s.totalTokens, 0);

    return {
      totalChunks: stats.chunks.total,
      totalTokens,
      bySource: {
        paper: stats.chunks.paperChunks,
        annotation: stats.chunks.annotationChunks,
        private: stats.chunks.privateChunks,
        memo: stats.chunks.memoChunks,
        note: stats.chunks.noteChunks,
        figure: stats.chunks.figureChunks,
      },
      embeddingDimension: this.config.rag.embeddingDimension,
      embeddingModel: this.config.rag.embeddingModel,
    };
  }

  // ════════════════════════════════════════
  // §10 向量引擎诊断
  // ════════════════════════════════════════

  /** §10.3 rowid 一致性检查 */
  checkVectorConsistency(): vectorDiagnostics.RowidConsistencyResult {
    return vectorDiagnostics.checkRowidConsistency(this.dbService.raw);
  }

  /** §10.1 向量字节长度抽样验证 */
  sampleVectorLengths(count: number = 10): vectorDiagnostics.VectorLengthSample[] {
    return vectorDiagnostics.sampleVectorLengths(
      this.dbService.raw,
      this.config.rag.embeddingDimension,
      count,
    );
  }

  /** §10.4 按 source 分组的 chunk 统计 */
  getChunkIndexStats(): vectorDiagnostics.ChunkIndexStats[] {
    return vectorDiagnostics.getChunkIndexStats(this.dbService.raw);
  }

  // TODO: UI 仪表板集成——通过 IPC 暴露诊断结果
}

// ═══ 工厂函数 ═══

export function createRagService(
  embedFn: EmbedFunction,
  dbService: DatabaseService,
  config: AbyssalConfig,
  logger: Logger,
  options?: {
    rerankFn?: RerankFunction | null | undefined;
    llmCall?: LlmCallFn | null | undefined;
  },
): RagService {
  return new RagService(embedFn, dbService, config, logger, options);
}
