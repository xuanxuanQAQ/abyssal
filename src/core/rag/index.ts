// ═══ RAG Module — 公共接口 ═══
//
// 检索核心：嵌入生成 + chunk 索引 + 三阶段混合检索 + Corrective RAG + 上下文组装

import type { AbyssalConfig } from '../types/config';
import type { EmbedFunction, PaperId, ConceptId } from '../types/common';
import type { TextChunk, RankedChunk, ChunkSource, SectionType } from '../types/chunk';
import type { RetrievalRequest, RetrievalResult } from '../types/retrieval';
import type { Relevance } from '../types/paper';
import type { Logger } from '../infra/logger';
import type { DatabaseService } from '../database';
import * as vectorDiagnostics from '../database/vector-diagnostics';

import { Embedder } from './embedder';
import { Reranker, type RerankFunction } from './reranker';
import { indexChunks, type IndexResult } from './indexer';
import { retrieve } from './retriever';
import type { LlmCallFn } from './corrective-rag';
import { checkEmbeddingConsistency } from '../database/embedding-migration';
import { rowToRankedChunk, memoToRankedChunk } from './chunk-mappers';
import { hasLayoutColumns } from '../database/prepared-statements';

// ─── 类型重导出 ───

export type { IndexResult } from './indexer';
export type { LlmCallFn } from './corrective-rag';
export type { RerankFunction } from './reranker';
export type { QueryExpansionResult } from './query-intelligence';
export { Embedder } from './embedder';
export { Reranker } from './reranker';
export { expandQuery, expandQueryHierarchical } from './query-intelligence';
export { assembleContext } from './context-assembler';

export interface RagDiagnosticsSummary {
  vectorConsistency: vectorDiagnostics.RowidConsistencyResult;
  vectorSamples: vectorDiagnostics.VectorLengthSample[];
  chunkStats: vectorDiagnostics.ChunkIndexStats[];
  degraded: boolean;
  degradedReason: string | null;
}

export interface RagServiceLike {
  readonly degraded: boolean;
  readonly degradedReason: string | null;
  embedAndIndexChunks(chunks: TextChunk[]): Promise<IndexResult>;
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
  searchSemantic(
    queryText: string,
    topK?: number,
    filters?: MetadataFilters,
  ): Promise<RankedChunk[]>;
  getDiagnosticsSummary(): RagDiagnosticsSummary | Promise<RagDiagnosticsSummary>;
}

// ─── §8.1 MetadataFilters ───

export interface MetadataFilters {
  paperIds?: PaperId[] | null | undefined;
  sources?: ChunkSource[] | null | undefined;
  sectionTypes?: SectionType[] | null | undefined;
  yearRange?: { min?: number | undefined; max?: number | undefined } | null | undefined;
  relevance?: Relevance[] | null | undefined;
  /** DLA block type filter (e.g., ['text', 'title'] to exclude figure/table chunks) */
  blockTypes?: string[] | null | undefined;
}

// ─── 高信息密度节类型（用于 searchByConcept 的 sectionType 偏好） ───

const HIGH_INFO_SECTION_TYPES: ReadonlySet<string> = new Set([
  'results', 'discussion', 'methods', 'conclusion',
]);

// ═══ RagService ═══

export class RagService implements RagServiceLike {
  private readonly embedder: Embedder;
  private readonly reranker: Reranker;
  private readonly dbService: DatabaseService;
  private readonly config: AbyssalConfig;
  private readonly logger: Logger;
  private readonly llmCall: LlmCallFn | null;

  /**
   * 当 DB 中已有 embedding 维度与当前配置不匹配时为 true。
   * 此时检索结果不可靠——调用方应提示用户运行 embedding 迁移。
   */
  readonly degraded: boolean;
  readonly degradedReason: string | null;

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

    // Fix #7: 启动时校验 DB embedding 维度与当前配置一致性
    let isDegraded = false;
    let degradedMsg: string | null = null;
    try {
      const consistency = checkEmbeddingConsistency(dbService.raw, config);
      if (!consistency.consistent) {
        isDegraded = true;
        degradedMsg = consistency.message ?? 'dimension mismatch';
        logger.error(
          `[RagService] EMBEDDING DIMENSION MISMATCH: ${consistency.message}. ` +
          `Retrieval results will be unreliable until migration is run.`,
          undefined,
          { existingDim: consistency.existingDim, configDim: consistency.configDim },
        );
      }
    } catch {
      // 新项目或 _meta 表不存在——静默跳过
    }
    this.degraded = isDegraded;
    this.degradedReason = degradedMsg;

    this.reranker = new Reranker(
      config.rag,
      {
        cohereApiKey: config.apiKeys.cohereApiKey ?? null,
        jinaApiKey: config.apiKeys.jinaApiKey ?? null,
        siliconflowApiKey: config.apiKeys.siliconflowApiKey ?? null,
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
      true, // API embedding backend
    );
  }

  /**
   * 嵌入 + 索引一体化方法——供 acquire 管线使用。
   * 内部先调 embedder 生成向量，再写入 chunk 索引。
   */
  async embedAndIndexChunks(chunks: TextChunk[]): Promise<IndexResult> {
    const t0 = Date.now();
    this.logger.info('[RagService] embedAndIndexChunks start', { chunkCount: chunks.length });

    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder.embed(texts);
    const tEmbed = Date.now();
    this.logger.info('[RagService] Embedding complete', {
      chunkCount: chunks.length,
      embeddingDim: embeddings[0]?.length ?? 0,
      embedDurationMs: tEmbed - t0,
    });

    const result = await this.indexChunks(chunks, embeddings);
    this.logger.info('[RagService] Index complete', {
      indexed: result.indexed,
      skipped: result.skipped,
      totalDurationMs: Date.now() - t0,
    });
    return result;
  }

  // ════════════════════════════════════════
  // §3-5 三阶段检索
  // ════════════════════════════════════════

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    if (this.degraded) {
      this.logger.warn(
        '[RagService] Retrieval invoked in degraded mode — results may be unreliable.',
        { reason: this.degradedReason },
      );
    }
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
    filters: MetadataFilters | null | undefined = {},
  ): Promise<RankedChunk[]> {
    // Defensive: IPC boundary can turn undefined into null, bypassing the default
    if (!filters) filters = {};
    const t0 = Date.now();
    this.logger.debug('[RagService] searchSemantic', {
      queryPreview: queryText.slice(0, 60),
      topK,
      filters: {
        paperIds: filters.paperIds?.length ?? 0,
        blockTypes: filters.blockTypes ?? null,
      },
    });
    const queryVec = await this.embedder.embedSingle(queryText);

    // 防御：校验 embedding 维度与配置一致
    if (queryVec.length !== this.config.rag.embeddingDimension) {
      throw new Error(
        `[searchSemantic] Embedding dimension mismatch: got ${queryVec.length}, expected ${this.config.rag.embeddingDimension}`,
      );
    }

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
      conditions.push(`c.paper_id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filters.paperIds));
    }
    if (hasLayoutColumns(db) && filters.blockTypes && filters.blockTypes.length > 0) {
      conditions.push(`c.block_type IN (${filters.blockTypes.map(() => '?').join(',')})`);
      params.push(...filters.blockTypes);
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

    const results = rows.slice(0, topK).map((row) =>
      rowToRankedChunk(row, 0, 'vector', {
        rawL2Distance: row['distance'] as number,
      }),
    ).map((c) => ({
      ...c,
      score: c.rawL2Distance != null ? 1 / (1 + c.rawL2Distance) : 0,
    }));

    this.logger.info('[RagService] searchSemantic complete', {
      rows: rows.length,
      returned: results.length,
      topScore: results[0]?.score ?? 0,
      durationMs: Date.now() - t0,
    });

    return results;
  }

  /** §8.2 按概念检索 */
  async searchByConcept(
    conceptId: ConceptId,
    topK: number = 10,
  ): Promise<RankedChunk[]> {
    const t0 = Date.now();
    const concept = this.dbService.getConcept(conceptId);
    if (!concept) {
      this.logger.warn('[RagService] searchByConcept: concept not found', { conceptId });
      return [];
    }
    this.logger.debug('[RagService] searchByConcept', { conceptId, conceptName: concept.nameEn, topK });

    // 精确映射路径——偏好高信息密度段落（results/discussion/methods/conclusion）
    const mappings = this.dbService.getMappingsByConcept(conceptId);
    const mappedChunks: RankedChunk[] = [];

    for (const m of mappings.slice(0, topK)) {
      const chunks = this.dbService.getChunksByPaper(m.paperId);
      // 优先选择高信息密度段落，回退到前 3 个
      const highInfo = chunks.filter((c) =>
        c.sectionType != null && HIGH_INFO_SECTION_TYPES.has(c.sectionType),
      );
      const selected = highInfo.length > 0 ? highInfo.slice(0, 3) : chunks.slice(0, 3);
      for (const c of selected) {
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

    // memo 路径——使用共享 memoToRankedChunk
    const memos = this.dbService.getMemosByEntity('concept', conceptId);
    const memoChunks: RankedChunk[] = memos.slice(0, 5).map((m) =>
      memoToRankedChunk(m, 0.9),
    );

    // 合并去重
    const seen = new Set<string>();
    const all: RankedChunk[] = [];
    for (const chunk of [...mappedChunks, ...vectorResults, ...memoChunks]) {
      if (!seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        all.push(chunk);
      }
    }

    const results = all.sort((a, b) => b.score - a.score).slice(0, topK);
    this.logger.info('[RagService] searchByConcept complete', {
      conceptId,
      mappedChunks: mappedChunks.length,
      vectorHits: vectorResults.length,
      memoHits: memoChunks.length,
      returned: results.length,
      durationMs: Date.now() - t0,
    });
    return results;
  }

  /** §8.3 搜索相似论文 */
  async searchSimilar(
    paperId: PaperId,
    topK: number = 10,
  ): Promise<RankedChunk[]> {
    this.logger.debug('[RagService] searchSimilar', { paperId: paperId.slice(0, 8), topK });
    const chunks = this.dbService.getChunksByPaper(paperId);
    const abstractChunk = chunks.find((c) => c.sectionLabel === 'abstract') ?? chunks[0];
    if (!abstractChunk) {
      this.logger.warn('[RagService] searchSimilar: no chunks for paper', { paperId: paperId.slice(0, 8) });
      return [];
    }

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
   * article 工作流通过 structuredRecall (taskType='article') 自动走此路径的等价逻辑。
   * 本方法保留供 UI 层独立调用（如大纲面板的快速预览）。
   */
  searchByOutlinePapers(
    paperIds: PaperId[],
    sectionTypes?: SectionType[] | null,
  ): RankedChunk[] {
    if (paperIds.length === 0) return [];
    const db = this.dbService.raw;

    const params: unknown[] = [JSON.stringify(paperIds)];

    let sectionFilter = '';
    if (sectionTypes && sectionTypes.length > 0) {
      sectionFilter = `AND c.section_type IN (${sectionTypes.map(() => '?').join(',')})`;
      params.push(...sectionTypes);
    }

    const rows = db.prepare(`
      SELECT c.*, p.title AS paper_title, p.year AS paper_year
      FROM chunks c
      JOIN papers p ON p.id = c.paper_id
      WHERE c.paper_id IN (SELECT value FROM json_each(?))
        AND c.source = 'paper'
        ${sectionFilter}
      ORDER BY c.paper_id, c.position_ratio ASC
    `).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => rowToRankedChunk(row, 1.0, 'structured'));
  }

  /** §8.4 索引统计（含 §10 诊断） */
  getIndexStats(): {
    totalChunks: number;
    totalTokens: number;
    bySource: Record<string, number>;
    embeddingDimension: number;
    embeddingModel: string;
    degraded: boolean;
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
      degraded: this.degraded,
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

  /** 诊断汇总——用于 IPC 暴露到 UI 仪表板 */
  getDiagnosticsSummary(): {
    vectorConsistency: vectorDiagnostics.RowidConsistencyResult;
    vectorSamples: vectorDiagnostics.VectorLengthSample[];
    chunkStats: vectorDiagnostics.ChunkIndexStats[];
    degraded: boolean;
    degradedReason: string | null;
  } {
    return {
      vectorConsistency: this.checkVectorConsistency(),
      vectorSamples: this.sampleVectorLengths(),
      chunkStats: this.getChunkIndexStats(),
      degraded: this.degraded,
      degradedReason: this.degradedReason,
    };
  }
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
