// ═══ Database Module — 公共接口 ═══
//
// database 模块是 Abyssal 系统的最底层状态持有者。
// 对外暴露 DatabaseService 类和 createDatabaseService 工厂函数。
//
// §1.1: 初始化序列（打开→PRAGMA→扩展→迁移→预编译→文件锁→返回）
// §5.1: 优雅关闭序列（停止接受→等待操作→Worker→checkpoint→close→释放锁）

import type Database from 'better-sqlite3';
import * as path from 'node:path';

import type { AbyssalConfig } from '../types/config';
import type { IDbService } from '../types/db-service';
import { DatabaseError } from '../types/errors';
import type { Logger } from '../infra/logger';
import type {
  PaperId, ConceptId, ChunkId, ArticleId, OutlineEntryId, DraftId,
  MemoId, NoteId, AnnotationId, SuggestionId,
  PaginatedResult,
} from '../types/common';
import type { PaperMetadata, PaperStatus } from '../types/paper';
import type { ConceptDefinition } from '../types/concept';
import type { ConceptMapping, RelationType, BilingualEvidence } from '../types/mapping';
import type { Annotation } from '../types/annotation';
import type { Article, Draft, DraftSectionMeta, DraftVersion, OutlineEntry, SectionDraft } from '../types/article';
import type { TextChunk } from '../types/chunk';
import type { ResearchMemo } from '../types/memo';
import type { ResearchNote } from '../types/note';
import type { SuggestedConcept, SuggestionStatus } from '../types/suggestion';
import type { PaperRelation } from '../types/relation';
import type { SeedType } from '../types/config';
import type { ChatMessageRecord, ChatSessionSummary, PaginationOpts } from '../../shared-types/models';

// ─── 连接 & 迁移 ───
import { openDatabase, walCheckpoint } from './connection';
import { runMigrations } from './migration';
import { writeTransaction } from './transaction-utils';

// ─── 文件锁 & 预编译语句 & 互斥 ───
import { FileLock } from './file-lock';
import { createStatements, releaseStatements, type StatementCache } from './prepared-statements';
import { Mutex } from '../infra/mutex';

// ─── DAO 模块 ───
import * as papersDao from './dao/papers';
import * as citationsDao from './dao/citations';
import * as conceptsDao from './dao/concepts';
import * as mappingsDao from './dao/mappings';
import * as annotationsDao from './dao/annotations';
import * as seedsDao from './dao/seeds';
import * as searchLogDao from './dao/search-log';
import * as chunksDao from './dao/chunks';
import * as memosDao from './dao/memos';
import * as notesDao from './dao/notes';
import * as suggestionsDao from './dao/suggestions';
import * as articlesDao from './dao/articles';
import * as draftsDao from './dao/drafts';
import * as discoverRunsDao from './dao/discover-runs';
import * as relationsDao from './dao/relations';
import * as referencesDao from './dao/references';
import * as chatDao from './dao/chat';
import * as statsDao from './dao/stats';
import * as reconCacheDao from './dao/recon-cache';
import * as auditLogDao from './dao/audit-log';
import * as sessionStateDao from './dao/session-state';
import * as layoutBlocksDao from './dao/layout-blocks';
import * as ocrLinesDao from './dao/ocr-lines';

// ─── 快照 ───
import * as snapshotMod from './snapshot';

// ─── 类型重导出 ───
export type { QueryPapersFilter } from './dao/papers';
export type {
  UpdateConceptFields,
  GcConceptChangeResult,
  ConflictEntry,
  ConflictResolution,
  MergeConceptsResult,
  SplitConceptResult,
  SyncConceptsResult,
} from './dao/concepts';
export type { ConceptMatrixEntry } from './dao/mappings';
export type { MemoEntityType, AddMemoResult } from './dao/memos';
export type { UpgradeFromMemoResult } from './dao/notes';
export type { Seed } from './dao/seeds';
export type { SearchLogEntry } from './dao/search-log';
export type {
  SemanticSearchFn,
  GraphNode,
  GraphEdge,
  RelationGraphFilter,
} from './dao/relations';
export type { DatabaseStats, IntegrityReport, IntegrityCheckResult } from './dao/stats';
export type { ReferenceRow, HydrateLogRow } from './dao/references';
export type { SnapshotMeta } from './snapshot';

// ═══ DatabaseService ═══

export class DatabaseService implements IDbService {
  private readonly db: Database.Database;
  private readonly config: AbyssalConfig;
  private readonly logger: Logger;
  private readonly dbPath: string;
  private readonly fileLock: FileLock;
  private stmts: StatementCache | null;

  // §5.1: 关闭状态管理
  private isClosing = false;
  private activeOps = 0;

  /**
   * Fix #1: Worker 写入暂停回调。
   * 由 Orchestrator 层通过 setPauseWorkerWrites() 注入。
   * checkpoint / close 时调用以防止 TRUNCATE 与长写事务死锁导致 UI 冻结。
   */
  private pauseWorkerWrites?: () => (() => void);

  /**
   * Worker Thread 引用。
   * 由 Orchestrator 层通过 setWorkerRef() 注入。
   * close() 时调用 worker.terminate() 释放线程资源。
   */
  private workerRef?: { terminate: () => Promise<number> } | undefined;

  /**
   * §3.3: CLI 批量模式的写操作互斥锁。
   * 防御性措施——在选项 A 策略（异步操作在事务外完成）下理论不需要，
   * 但防止未来代码修改无意中在事务内引入 async 操作。
   * CLI Orchestrator 启动时应通过 dbWriteMutex.runExclusive 包装写操作。
   */
  readonly dbWriteMutex = new Mutex();

  constructor(
    db: Database.Database,
    config: AbyssalConfig,
    logger: Logger,
    dbPath: string,
    fileLock: FileLock,
    stmts: StatementCache,
  ) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.dbPath = dbPath;
    this.fileLock = fileLock;
    this.stmts = stmts;
  }

  /**
   * 注册 Worker 写入暂停回调。
   *
   * Orchestrator 初始化 Worker Thread 后调用此方法注入回调。
   * 回调被 walCheckpoint / close 在执行 TRUNCATE 前调用，
   * 确保 Worker 当前事务提交后暂停写入队列，防止 UI 冻结。
   */
  setPauseWorkerWrites(fn: () => (() => void)): void {
    this.pauseWorkerWrites = fn;
  }

  /**
   * 注册 Worker Thread 引用。
   * Orchestrator 初始化 Worker Thread 后调用此方法注入引用，
   * 使 close() 能够终止 Worker 释放线程资源。
   */
  setWorkerRef(worker: { terminate: () => Promise<number> }): void {
    this.workerRef = worker;
  }

  /** 获取底层 better-sqlite3 实例（仅供高级用途） */
  get raw(): Database.Database {
    return this.db;
  }

  /** 获取预编译语句缓存 */
  get statements(): StatementCache | null {
    return this.stmts;
  }

  // ─── §5.1 操作守卫 ───

  /**
   * 包装数据库操作：检查 isClosing → activeOps++ → 执行 → activeOps--
   */
  private withOp<T>(fn: () => T): T {
    if (this.isClosing) {
      throw new DatabaseError({
        message: 'Database is closing, cannot accept new operations',
        context: { dbPath: this.dbPath, reason: 'closing' },
      });
    }
    this.activeOps++;
    try {
      return fn();
    } finally {
      this.activeOps--;
    }
  }

  // withAsyncOp 已移除——DatabaseService 的 activeOps 仅跟踪纯同步的数据库操作。
  // 异步编排（如 createSnapshot 的流式压缩）属于 Orchestrator 层的职责。
  // 在 Node.js 单线程中，只要能执行到 close()，就说明当前没有同步 DB 操作在跑。

  // ════════════════════════════════════════
  // §3 论文 CRUD
  // ════════════════════════════════════════

  addPaper(paper: PaperMetadata, status?: Partial<PaperStatus>): PaperId {
    return this.withOp(() => papersDao.addPaper(this.db, paper, status));
  }

  updatePaper(id: PaperId, updates: Partial<PaperMetadata & PaperStatus>): number {
    return this.withOp(() => papersDao.updatePaper(this.db, id, updates));
  }

  getPaper(id: PaperId): (PaperMetadata & PaperStatus) | null {
    return this.withOp(() => papersDao.getPaper(this.db, id));
  }

  queryPapers(filter: papersDao.QueryPapersFilter): PaginatedResult<PaperMetadata & PaperStatus> {
    return this.withOp(() => papersDao.queryPapers(this.db, filter));
  }

  deletePaper(id: PaperId, cascade: boolean = true): number {
    return this.withOp(() => papersDao.deletePaper(this.db, id, cascade));
  }

  // ════════════════════════════════════════
  // 引用关系
  // ════════════════════════════════════════

  addCitation(citingId: PaperId, citedId: PaperId): void {
    this.withOp(() => citationsDao.addCitation(this.db, citingId, citedId));
  }

  addCitations(pairs: Array<{ citingId: PaperId; citedId: PaperId }>): void {
    this.withOp(() => citationsDao.addCitations(this.db, pairs));
  }

  getCitationsFrom(citingId: PaperId): PaperId[] {
    return this.withOp(() => citationsDao.getCitationsFrom(this.db, citingId));
  }

  getCitationsTo(citedId: PaperId): PaperId[] {
    return this.withOp(() => citationsDao.getCitationsTo(this.db, citedId));
  }

  deleteCitation(citingId: PaperId, citedId: PaperId): number {
    return this.withOp(() => citationsDao.deleteCitation(this.db, citingId, citedId));
  }

  // ════════════════════════════════════════
  // §4 概念框架
  // ════════════════════════════════════════

  addConcept(concept: ConceptDefinition): void {
    this.withOp(() => conceptsDao.addConcept(this.db, concept));
  }

  updateConcept(
    id: ConceptId,
    fields: conceptsDao.UpdateConceptFields,
    isBreaking: boolean = false,
  ): conceptsDao.GcConceptChangeResult {
    return this.withOp(() =>
      conceptsDao.updateConcept(
        this.db, id, fields, isBreaking,
        this.config.concepts.additiveChangeLookbackDays,
      ),
    );
  }

  deprecateConcept(id: ConceptId, reason: string): conceptsDao.GcConceptChangeResult {
    return this.withOp(() => conceptsDao.deprecateConcept(this.db, id, reason));
  }

  syncConcepts(
    concepts: ConceptDefinition[],
    strategy: 'merge' | 'replace',
    isBreakingMap?: Record<string, boolean>,
  ): conceptsDao.SyncConceptsResult {
    return this.withOp(() =>
      conceptsDao.syncConcepts(
        this.db, concepts, strategy, isBreakingMap,
        this.config.concepts.additiveChangeLookbackDays,
      ),
    );
  }

  mergeConcepts(
    keepConceptId: ConceptId,
    mergeConceptId: ConceptId,
    conflictResolution?: conceptsDao.ConflictResolution,
  ): conceptsDao.MergeConceptsResult {
    return this.withOp(() =>
      conceptsDao.mergeConcepts(this.db, keepConceptId, mergeConceptId, conflictResolution),
    );
  }

  splitConcept(
    originalConceptId: ConceptId,
    newConceptA: ConceptDefinition,
    newConceptB: ConceptDefinition,
  ): conceptsDao.SplitConceptResult {
    return this.withOp(() =>
      conceptsDao.splitConcept(this.db, originalConceptId, newConceptA, newConceptB),
    );
  }

  gcConceptChange(
    conceptId: ConceptId,
    changeType: 'definition_refined' | 'deprecated' | 'deleted',
    isBreaking?: boolean,
  ): conceptsDao.GcConceptChangeResult {
    return this.withOp(() =>
      conceptsDao.gcConceptChange(
        this.db, conceptId, changeType, isBreaking,
        this.config.concepts.additiveChangeLookbackDays,
      ),
    );
  }

  getConcept(id: ConceptId): ConceptDefinition | null {
    return this.withOp(() => conceptsDao.getConcept(this.db, id));
  }

  getAllConcepts(includeDeprecated?: boolean): ConceptDefinition[] {
    return this.withOp(() => conceptsDao.getAllConcepts(this.db, includeDeprecated));
  }

  // ════════════════════════════════════════
  // 论文-概念映射
  // ════════════════════════════════════════

  mapPaperConcept(mapping: ConceptMapping): void {
    this.withOp(() => mappingsDao.mapPaperConcept(this.db, mapping));
  }

  mapPaperConceptBatch(mappings: ConceptMapping[]): void {
    this.withOp(() => mappingsDao.mapPaperConceptBatch(this.db, mappings));
  }

  updateMapping(
    paperId: PaperId,
    conceptId: ConceptId,
    updates: {
      relation?: RelationType;
      confidence?: number;
      evidence?: BilingualEvidence;
      reviewed?: boolean;
      reviewedAt?: string | null;
    },
  ): number {
    return this.withOp(() => mappingsDao.updateMapping(this.db, paperId, conceptId, updates));
  }

  getMappingsByPaper(paperId: PaperId): ConceptMapping[] {
    return this.withOp(() => mappingsDao.getMappingsByPaper(this.db, paperId));
  }

  getMappingsByConcept(conceptId: ConceptId): ConceptMapping[] {
    return this.withOp(() => mappingsDao.getMappingsByConcept(this.db, conceptId));
  }

  getMapping(paperId: PaperId, conceptId: ConceptId): ConceptMapping | null {
    return this.withOp(() => mappingsDao.getMapping(this.db, paperId, conceptId));
  }

  deleteMapping(paperId: PaperId, conceptId: ConceptId): number {
    return this.withOp(() => mappingsDao.deleteMapping(this.db, paperId, conceptId));
  }

  getConceptMatrix(): mappingsDao.ConceptMatrixEntry[] {
    return this.withOp(() => mappingsDao.getConceptMatrix(this.db));
  }

  adjudicateMapping(
    paperId: PaperId,
    conceptId: ConceptId,
    decision: mappingsDao.AdjudicationDecision,
    revisions?: { relation?: RelationType; confidence?: number; note?: string },
  ): number {
    return this.withOp(() => mappingsDao.adjudicateMapping(this.db, paperId, conceptId, decision, revisions));
  }

  countMappingsForConceptInPapers(conceptId: ConceptId, paperIds: string[]): number {
    return this.withOp(() => mappingsDao.countMappingsForConceptInPapers(this.db, conceptId, paperIds));
  }

  getConceptMappingStats(conceptId: ConceptId): mappingsDao.ConceptStatsResult {
    return this.withOp(() => mappingsDao.getConceptStats(this.db, conceptId));
  }

  /**
   * §10.1: Atomic analysis completion — writes mappings + updates status in a single transaction.
   * Prevents inconsistent state where mappings exist but status is still 'in_progress'.
   */
  completeAnalysis(
    paperId: PaperId,
    mappings: ConceptMapping[],
    status: 'completed' | 'failed',
    failureReason?: string | null,
    analysisPath?: string | null,
  ): void {
    return this.withOp(() => {
      writeTransaction(this.db, () => {
        // Write mappings
        if (mappings.length > 0) {
          mappingsDao.mapPaperConceptBatch(this.db, mappings);
        }
        // Update status atomically
        papersDao.updatePaper(this.db, paperId, {
          analysisStatus: status,
          ...(failureReason != null && { failureReason }),
          ...(analysisPath != null && { analysisPath }),
        });
      });
    });
  }

  /**
   * Reset analysis for a paper: delete mappings, clear analysis file, reset status.
   * Returns the analysisPath that was cleared (so caller can delete the file).
   */
  resetAnalysis(paperId: PaperId): string | null {
    return this.withOp(() => {
      let analysisPath: string | null = null;

      writeTransaction(this.db, () => {
        // Read inside transaction to prevent TOCTOU race
        const paper = papersDao.getPaper(this.db, paperId);
        analysisPath = (paper as unknown as Record<string, unknown>)?.['analysisPath'] as string | null ?? null;

        mappingsDao.deleteMappingsForPaper(this.db, paperId);
        papersDao.updatePaper(this.db, paperId, {
          analysisStatus: 'not_started',
          analysisPath: null,
          failureReason: null,
        });
      });

      return analysisPath;
    });
  }

  // ════════════════════════════════════════
  // 标注
  // ════════════════════════════════════════

  addAnnotation(annotation: Omit<Annotation, 'id'>): AnnotationId {
    return this.withOp(() => annotationsDao.addAnnotation(this.db, annotation));
  }

  getAnnotations(paperId: PaperId): Annotation[] {
    return this.withOp(() => annotationsDao.getAnnotations(this.db, paperId));
  }

  getAnnotation(id: AnnotationId): Annotation | null {
    return this.withOp(() => annotationsDao.getAnnotation(this.db, id));
  }

  updateAnnotation(id: AnnotationId, patch: annotationsDao.AnnotationPatch): number {
    return this.withOp(() => annotationsDao.updateAnnotation(this.db, id, patch));
  }

  deleteAnnotation(id: AnnotationId): number {
    return this.withOp(() => annotationsDao.deleteAnnotation(this.db, id));
  }

  getAnnotationsByConcept(conceptId: ConceptId): Annotation[] {
    return this.withOp(() => annotationsDao.getAnnotationsByConcept(this.db, conceptId));
  }

  countAnnotationsForPaperConcept(paperId: PaperId, conceptId: ConceptId): number {
    return this.withOp(() => annotationsDao.countAnnotationsForPaperConcept(this.db, paperId, conceptId));
  }

  batchCountAnnotationsByPaper(paperId: PaperId): Map<string, number> {
    return this.withOp(() => annotationsDao.batchCountAnnotationsByPaper(this.db, paperId));
  }

  batchCountMappingsByPapers(paperIds: string[]): Map<string, number> {
    return this.withOp(() => annotationsDao.batchCountMappingsByPapers(this.db, paperIds));
  }

  // ════════════════════════════════════════
  // 搜索历史
  // ════════════════════════════════════════

  listDiscoverRuns(): ReturnType<typeof discoverRunsDao.listDiscoverRuns> {
    return this.withOp(() => discoverRunsDao.listDiscoverRuns(this.db));
  }

  addDiscoverRun(run: { id: string; query: string; resultCount: number }): void {
    this.withOp(() => discoverRunsDao.addDiscoverRun(this.db, run));
  }

  // ════════════════════════════════════════
  // 种子论文
  // ════════════════════════════════════════

  addSeed(paperId: PaperId, seedType: SeedType): void {
    this.withOp(() => seedsDao.addSeed(this.db, paperId, seedType));
  }

  getSeeds(): seedsDao.Seed[] {
    return this.withOp(() => seedsDao.getSeeds(this.db));
  }

  removeSeed(paperId: PaperId): number {
    return this.withOp(() => seedsDao.removeSeed(this.db, paperId));
  }

  // ════════════════════════════════════════
  // 检索日志
  // ════════════════════════════════════════

  addSearchLog(query: string, apiSource: string, resultCount: number): number {
    return this.withOp(() => searchLogDao.addSearchLog(this.db, query, apiSource, resultCount));
  }

  getSearchLog(limit?: number): searchLogDao.SearchLogEntry[] {
    return this.withOp(() => searchLogDao.getSearchLog(this.db, limit));
  }

  // ════════════════════════════════════════
  // 文本块 + 向量
  // ════════════════════════════════════════

  // Phase 1：仅写入文本（主线程安全，不阻塞 UI）
  insertChunkTextOnly(chunk: TextChunk): number {
    return this.withOp(() => chunksDao.insertChunkTextOnly(this.db, chunk));
  }

  insertChunksTextOnlyBatch(chunks: TextChunk[]): number[] {
    return this.withOp(() => chunksDao.insertChunksTextOnlyBatch(this.db, chunks));
  }

  // Phase 2：仅写入向量（设计用于 Worker Thread 独立连接）
  insertChunkVectors(rowids: number[], embeddings: Float32Array[]): void {
    this.withOp(() => chunksDao.insertChunkVectors(this.db, rowids, embeddings));
  }

  // 便捷：chunk + 向量一次写入（小数据量场景）
  insertChunk(chunk: TextChunk, embedding: Float32Array | null): number {
    return this.withOp(() => chunksDao.insertChunk(this.db, chunk, embedding));
  }

  insertChunksBatch(chunks: TextChunk[], embeddings: (Float32Array | null)[]): number[] {
    return this.withOp(() => chunksDao.insertChunksBatch(this.db, chunks, embeddings));
  }

  deleteChunksByPaper(paperId: PaperId): number {
    return this.withOp(() => chunksDao.deleteChunksByPaper(this.db, paperId));
  }

  deleteChunksByPrefix(prefix: string): number {
    return this.withOp(() => chunksDao.deleteChunksByPrefix(this.db, prefix));
  }

  getChunksByPaper(paperId: PaperId): TextChunk[] {
    return this.withOp(() => chunksDao.getChunksByPaper(this.db, paperId));
  }

  getChunkByChunkId(chunkId: ChunkId): TextChunk | null {
    return this.withOp(() => chunksDao.getChunkByChunkId(this.db, chunkId));
  }

  /** 批量查询已存在的 chunk_id 集合 */
  getExistingChunkIds(chunkIds: string[]): Set<string> {
    return this.withOp(() => chunksDao.getExistingChunkIds(this.db, chunkIds));
  }

  // ════════════════════════════════════════
  // §5 碎片笔记
  // ════════════════════════════════════════

  addMemo(
    memo: Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>,
    embedding: Float32Array | null,
  ): memosDao.AddMemoResult {
    return this.withOp(() => memosDao.addMemo(this.db, memo, embedding));
  }

  markMemoIndexed(id: MemoId): void {
    this.withOp(() => memosDao.markMemoIndexed(this.db, id));
  }

  updateMemo(
    id: MemoId,
    updates: Partial<Pick<ResearchMemo, 'text' | 'paperIds' | 'conceptIds' | 'annotationId' | 'outlineId' | 'linkedNoteIds' | 'tags'>>,
    newEmbedding?: Float32Array | null,
  ): number {
    return this.withOp(() => memosDao.updateMemo(this.db, id, updates, newEmbedding));
  }

  getMemosByEntity(entityType: memosDao.MemoEntityType, entityId: string | number): ResearchMemo[] {
    return this.withOp(() => memosDao.getMemosByEntity(this.db, entityType, entityId));
  }

  queryMemos(filter?: { paperIds?: string[]; conceptIds?: string[]; tags?: string[]; searchText?: string; limit?: number; offset?: number }): ResearchMemo[] {
    return this.withOp(() => memosDao.queryMemos(this.db, filter));
  }

  getMemo(id: MemoId): ResearchMemo | null {
    return this.withOp(() => memosDao.getMemo(this.db, id));
  }

  deleteMemo(id: MemoId): number {
    return this.withOp(() => memosDao.deleteMemo(this.db, id));
  }

  // ════════════════════════════════════════
  // §6 结构化笔记
  // ════════════════════════════════════════

  createNote(
    note: Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
    chunks: TextChunk[],
    embeddings: (Float32Array | null)[],
  ): void {
    this.withOp(() => notesDao.createNote(this.db, note, chunks, embeddings));
  }

  saveNoteContent(
    noteId: NoteId,
    documentJson: string,
    chunks: TextChunk[],
    embeddings: (Float32Array | null)[],
  ): void {
    this.withOp(() => notesDao.saveNoteContent(this.db, noteId, documentJson, chunks, embeddings));
  }

  updateNoteMeta(
    id: NoteId,
    updates: Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>,
  ): ResearchNote | null {
    return this.withOp(() => notesDao.updateNoteMeta(this.db, id, updates));
  }

  queryNotes(filter?: { conceptIds?: string[]; paperIds?: string[]; tags?: string[]; searchText?: string }): ResearchNote[] {
    return this.withOp(() => notesDao.queryNotes(this.db, filter));
  }

  linkMemoToNote(memoId: MemoId, noteId: NoteId): void {
    this.withOp(() => notesDao.linkMemoToNote(this.db, memoId, noteId));
  }

  linkNoteToConcept(noteId: NoteId, conceptId: ConceptId): void {
    this.withOp(() => notesDao.linkNoteToConcept(this.db, noteId, conceptId));
  }

  getNote(id: NoteId): ResearchNote | null {
    return this.withOp(() => notesDao.getNote(this.db, id));
  }

  getAllNotes(): ResearchNote[] {
    return this.withOp(() => notesDao.getAllNotes(this.db));
  }

  deleteNote(id: NoteId): number {
    return this.withOp(() => notesDao.deleteNote(this.db, id));
  }

  // ════════════════════════════════════════
  // §7 概念建议
  // ════════════════════════════════════════

  addSuggestedConcept(input: {
    term: string;
    frequencyInPaper: number;
    sourcePaperId: PaperId;
    closestExistingConceptId?: ConceptId | null;
    closestExistingConceptSimilarity?: string | null;
    reason: string;
  }): SuggestionId {
    return this.withOp(() => suggestionsDao.addSuggestedConcept(this.db, input));
  }

  adoptSuggestedConcept(
    suggestionId: SuggestionId,
    conceptOverrides?: Partial<ConceptDefinition>,
  ): ConceptId {
    return this.withOp(() => suggestionsDao.adoptSuggestedConcept(this.db, suggestionId, conceptOverrides));
  }

  dismissSuggestedConcept(suggestionId: SuggestionId): number {
    return this.withOp(() => suggestionsDao.dismissSuggestedConcept(this.db, suggestionId));
  }

  getSuggestedConcepts(status?: SuggestionStatus, limit?: number): SuggestedConcept[] {
    return this.withOp(() => suggestionsDao.getSuggestedConcepts(this.db, status, limit));
  }

  getSuggestedConcept(id: SuggestionId): SuggestedConcept | null {
    return this.withOp(() => suggestionsDao.getSuggestedConcept(this.db, id));
  }

  restoreSuggestedConcept(suggestionId: SuggestionId): number {
    return this.withOp(() => suggestionsDao.restoreSuggestedConcept(this.db, suggestionId));
  }

  getSuggestedConceptsStats(): suggestionsDao.SuggestedConceptsStatsResult {
    return this.withOp(() => suggestionsDao.getSuggestedConceptsStats(this.db));
  }

  // ════════════════════════════════════════
  // §8 文章 / 纲要 / 草稿
  // ════════════════════════════════════════

  createArticle(article: Omit<Article, 'createdAt' | 'updatedAt'>): ArticleId {
    return this.withOp(() => articlesDao.createArticle(this.db, article));
  }

  getArticle(id: ArticleId): Article | null {
    return this.withOp(() => articlesDao.getArticle(this.db, id));
  }

  updateArticle(
    id: ArticleId,
    updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status' | 'documentJson' | 'abstract' | 'keywords' | 'authors' | 'targetWordCount'>>,
  ): number {
    return this.withOp(() => articlesDao.updateArticle(this.db, id, updates));
  }

  getAllArticles(): Article[] {
    return this.withOp(() => articlesDao.getAllArticles(this.db));
  }

  deleteArticle(id: ArticleId): number {
    return this.withOp(() => articlesDao.deleteArticle(this.db, id));
  }

  getArticleDocument(articleId: ArticleId): { articleId: ArticleId; documentJson: string; updatedAt: string } {
    return this.withOp(() => articlesDao.getArticleDocument(this.db, articleId));
  }

  saveArticleDocument(articleId: ArticleId, documentJson: string, source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite'): void {
    this.withOp(() => articlesDao.saveArticleDocument(this.db, articleId, documentJson, source));
  }

  setOutline(articleId: ArticleId, entries: OutlineEntry[]): void {
    this.withOp(() => articlesDao.setOutline(this.db, articleId, entries));
  }

  getOutline(articleId: ArticleId): OutlineEntry[] {
    return this.withOp(() => articlesDao.getOutline(this.db, articleId));
  }

  listDraftsByArticle(articleId: ArticleId): Draft[] {
    return this.withOp(() => draftsDao.listDraftsByArticle(this.db, articleId));
  }

  getDraft(id: DraftId): Draft | null {
    return this.withOp(() => draftsDao.getDraft(this.db, id));
  }

  createDraft(draft: Omit<Draft, 'createdAt' | 'updatedAt'>): DraftId {
    return this.withOp(() => draftsDao.createDraft(this.db, draft));
  }

  updateDraft(
    id: DraftId,
    updates: Partial<Pick<Draft, 'title' | 'status' | 'language' | 'audience' | 'writingStyle' | 'cslStyleId' | 'abstract' | 'keywords' | 'targetWordCount' | 'lastOpenedAt'>>,
  ): number {
    return this.withOp(() => draftsDao.updateDraft(this.db, id, updates));
  }

  deleteDraft(id: DraftId): number {
    return this.withOp(() => draftsDao.deleteDraft(this.db, id));
  }

  getDraftDocument(draftId: DraftId): { draftId: DraftId; articleId: ArticleId; documentJson: string; updatedAt: string } {
    return this.withOp(() => draftsDao.getDraftDocument(this.db, draftId));
  }

  saveDraftDocument(draftId: DraftId, documentJson: string, source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate'): void {
    this.withOp(() => draftsDao.saveDraftDocument(this.db, draftId, documentJson, source));
  }

  getDraftSections(draftId: DraftId) {
    return this.withOp(() => draftsDao.getDraftSections(this.db, draftId));
  }

  getDraftSectionMeta(draftId: DraftId): DraftSectionMeta[] {
    return this.withOp(() => draftsDao.getDraftSectionMeta(this.db, draftId));
  }

  updateDraftSectionMeta(
    draftId: DraftId,
    sectionId: string,
    patch: Partial<Pick<DraftSectionMeta, 'lineageId' | 'basedOnSectionId' | 'status' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'aiModel' | 'evidenceStatus' | 'evidenceGaps'>>,
  ): number {
    return this.withOp(() => draftsDao.updateDraftSectionMeta(this.db, draftId, sectionId, patch));
  }

  updateDraftSectionContent(
    draftId: DraftId,
    sectionId: string,
    content: string,
    documentJson?: string | null,
    source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate' = 'manual',
  ): void {
    this.withOp(() => draftsDao.updateDraftSectionContent(this.db, draftId, sectionId, content, documentJson, source));
  }

  getDraftVersions(draftId: DraftId): DraftVersion[] {
    return this.withOp(() => draftsDao.getDraftVersions(this.db, draftId));
  }

  restoreDraftVersion(draftId: DraftId, version: number): void {
    this.withOp(() => draftsDao.restoreDraftVersion(this.db, draftId, version));
  }

  createDraftFromVersion(draftId: DraftId, version: number, title: string): DraftId {
    return this.withOp(() => draftsDao.createDraftFromVersion(this.db, draftId, version, title));
  }

  getOutlineEntry(id: OutlineEntryId): OutlineEntry | null {
    return this.withOp(() => articlesDao.getOutlineEntry(this.db, id));
  }

  updateOutlineEntry(
    id: OutlineEntryId,
    updates: Partial<Pick<OutlineEntry, 'title' | 'coreArgument' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status' | 'sortOrder'>>,
  ): number {
    return this.withOp(() => articlesDao.updateOutlineEntry(this.db, id, updates));
  }

  markOutlineEntryDeleted(id: OutlineEntryId): number {
    return this.withOp(() => articlesDao.markOutlineEntryDeleted(this.db, id));
  }

  searchSections(query: string): Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }> {
    return this.withOp(() => articlesDao.searchSections(this.db, query));
  }

  addSectionDraft(outlineEntryId: OutlineEntryId, content: string, llmBackend: string, source?: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite', documentJson?: string | null): number {
    return this.withOp(() => articlesDao.addSectionDraft(this.db, outlineEntryId, content, llmBackend, source, documentJson));
  }

  getSectionDrafts(outlineEntryId: OutlineEntryId): SectionDraft[] {
    return this.withOp(() => articlesDao.getSectionDrafts(this.db, outlineEntryId));
  }

  markEditedParagraphs(outlineEntryId: OutlineEntryId, version: number, paragraphIndices: number[]): number {
    return this.withOp(() => articlesDao.markEditedParagraphs(this.db, outlineEntryId, version, paragraphIndices));
  }

  getFullDocument(articleId: ArticleId) {
    return this.withOp(() => articlesDao.getFullDocument(this.db, articleId));
  }

  saveDocumentSections(articleId: ArticleId, sections: Parameters<typeof articlesDao.saveDocumentSections>[2]) {
    this.withOp(() => articlesDao.saveDocumentSections(this.db, articleId, sections));
  }

  cleanupVersions(articleId: ArticleId, keepCount: number): number {
    return this.withOp(() => articlesDao.cleanupVersions(this.db, articleId, keepCount));
  }

  addArticleAsset(asset: import('../types/article').ArticleAsset): void {
    this.withOp(() => articlesDao.addArticleAsset(this.db, asset));
  }

  getArticleAssets(articleId: ArticleId): import('../types/article').ArticleAsset[] {
    return this.withOp(() => articlesDao.getArticleAssets(this.db, articleId));
  }

  getArticleAsset(assetId: string): import('../types/article').ArticleAsset | null {
    return this.withOp(() => articlesDao.getArticleAsset(this.db, assetId));
  }

  deleteArticleAsset(assetId: string): number {
    return this.withOp(() => articlesDao.deleteArticleAsset(this.db, assetId));
  }

  // ════════════════════════════════════════
  // §9 派生关系
  // ════════════════════════════════════════

  computeRelationsForPaper(
    paperId: PaperId,
    semanticSearchFn: relationsDao.SemanticSearchFn | null,
  ): void {
    this.withOp(() => relationsDao.computeRelationsForPaper(this.db, paperId, semanticSearchFn));
  }

  recomputeAllRelations(semanticSearchFn: relationsDao.SemanticSearchFn | null): number {
    return this.withOp(() => relationsDao.recomputeAllRelations(this.db, semanticSearchFn));
  }

  getRelationGraph(filter: relationsDao.RelationGraphFilter): { nodes: relationsDao.GraphNode[]; edges: relationsDao.GraphEdge[] } {
    return this.withOp(() => relationsDao.getRelationGraph(this.db, filter));
  }

  getRelationsForPaper(paperId: PaperId): PaperRelation[] {
    return this.withOp(() => relationsDao.getRelationsForPaper(this.db, paperId));
  }

  // ════════════════════════════════════════
  // §10 统计与完整性
  // ════════════════════════════════════════

  // ════════════════════════════════════════
  // §11 参考文献 + 水合日志
  // ════════════════════════════════════════

  upsertReferences(paperId: PaperId, refs: import('../process').ExtractedReference[]): number {
    return this.withOp(() => referencesDao.upsertReferences(this.db, paperId, refs));
  }

  insertHydrateLogs(paperId: PaperId, logs: Array<{ field: string; value: unknown; source: string }>): void {
    this.withOp(() => referencesDao.insertHydrateLogs(this.db, paperId, logs));
  }

  getReferencesByPaper(paperId: PaperId): referencesDao.ReferenceRow[] {
    return this.withOp(() => referencesDao.getReferencesByPaper(this.db, paperId));
  }

  getHydrateLog(paperId: PaperId): referencesDao.HydrateLogRow[] {
    return this.withOp(() => referencesDao.getHydrateLog(this.db, paperId));
  }

  getUnresolvedRefsWithDoi(paperId: PaperId): referencesDao.ReferenceRow[] {
    return this.withOp(() => referencesDao.getUnresolvedRefsWithDoi(this.db, paperId));
  }

  resolveReference(refId: number, resolvedPaperId: PaperId): void {
    this.withOp(() => referencesDao.resolveReference(this.db, refId, resolvedPaperId));
  }

  // ════════════════════════════════════════
  // 聊天消息持久化
  // ════════════════════════════════════════

  saveChatMessage(record: ChatMessageRecord): void {
    this.withOp(() => chatDao.saveMessage(this.db, record));
  }

  getChatHistory(contextKey: string, opts?: PaginationOpts): ChatMessageRecord[] {
    return this.withOp(() => chatDao.getHistory(this.db, contextKey, opts));
  }

  deleteChatSession(contextKey: string): void {
    this.withOp(() => chatDao.deleteSession(this.db, contextKey));
  }

  listChatSessions(): ChatSessionSummary[] {
    return this.withOp(() => chatDao.listSessions(this.db));
  }

  // ════════════════════════════════════════
  // Recon Cache (Acquire Pipeline v2)
  // ════════════════════════════════════════

  getRecon(doi: string): ReturnType<typeof reconCacheDao.getRecon> {
    return this.withOp(() => reconCacheDao.getRecon(this.db, doi));
  }

  upsertRecon(recon: Parameters<typeof reconCacheDao.upsertRecon>[1]): void {
    this.withOp(() => reconCacheDao.upsertRecon(this.db, recon));
  }

  insertAuditLog(entry: Parameters<typeof auditLogDao.insertAuditLog>[1]): number {
    return this.withOp(() => auditLogDao.insertAuditLog(this.db, entry));
  }

  // ─── 会话状态持久化 ───

  saveSessionMemory(entries: sessionStateDao.MemoryRow[]): void {
    this.withOp(() => sessionStateDao.saveMemoryEntries(this.db, entries));
  }

  loadSessionMemory(): sessionStateDao.MemoryRow[] {
    return this.withOp(() => sessionStateDao.loadMemoryEntries(this.db));
  }

  saveSessionConversation(key: string, messagesJson: string): void {
    this.withOp(() => sessionStateDao.saveConversation(this.db, key, messagesJson));
  }

  loadSessionConversation(key: string): string | null {
    return this.withOp(() => sessionStateDao.loadConversation(this.db, key));
  }

  getStats(): statsDao.DatabaseStats {
    return this.withOp(() => statsDao.getStats(this.db));
  }

  checkIntegrity(): statsDao.IntegrityReport {
    return this.withOp(() => statsDao.checkIntegrity(this.db));
  }

  /**
   * 获取论文关联的全部文件相对路径列表。
   *
   * 用于 deletePaper 事务成功后的文件清理（C2：文件操作在事务外）。
   * 返回的路径是相对于 workspace/ 的相对路径——由 PathResolver 在 I/O 前拼接绝对路径。
   *
   * Orchestrator 的 deletePaper 流程应为：
   *   1. const paths = db.getPaperFilePaths(id);
   *   2. const figDir = db.getPaperFigureDir(id);
   *   3. db.deletePaper(id, true);       // 事务内：级联删除 DB 数据
   *   4. await cleanupFiles(paths, figDir); // 事务外：批量删除文件
   */
  getPaperFilePaths(paperId: PaperId): string[] {
    const paths: string[] = [];

    // 从数据库获取已记录的路径
    const paper = this.withOp(() =>
      this.db.prepare('SELECT fulltext_path, text_path, analysis_path FROM papers WHERE id = ?')
        .get(paperId) as { fulltext_path: string | null; text_path: string | null; analysis_path: string | null } | undefined,
    );

    if (paper?.fulltext_path) paths.push(paper.fulltext_path);
    if (paper?.text_path) paths.push(paper.text_path);
    if (paper?.analysis_path) paths.push(paper.analysis_path);

    // 按约定可能存在的文件（不在数据库列中跟踪）
    paths.push(`analyses/${paperId}.raw.txt`);  // 解析失败的原始输出
    paths.push(`decisions/${paperId}.md`);       // 裁决记录

    return paths;
  }

  /**
   * 获取论文图表子目录的相对路径。
   * 返回 'figures/{paperId}'——整个子目录需要删除。
   */
  getPaperFigureDir(paperId: PaperId): string {
    return `figures/${paperId}`;
  }

  // ════════════════════════════════════════
  // §11.5 布局分析 + 章节边界
  // ════════════════════════════════════════

  insertLayoutBlocks(blocks: layoutBlocksDao.LayoutBlockRow[]): void {
    this.withOp(() => layoutBlocksDao.insertLayoutBlocks(this.db, blocks));
  }

  getLayoutBlocks(paperId: PaperId): layoutBlocksDao.LayoutBlockRow[] {
    return this.withOp(() => layoutBlocksDao.getLayoutBlocks(this.db, paperId));
  }

  getLayoutBlocksByPage(paperId: PaperId, pageIndex: number): layoutBlocksDao.LayoutBlockRow[] {
    return this.withOp(() => layoutBlocksDao.getLayoutBlocksByPage(this.db, paperId, pageIndex));
  }

  getLayoutModelVersion(paperId: PaperId): string | null {
    return this.withOp(() => layoutBlocksDao.getLayoutModelVersion(this.db, paperId));
  }

  deleteLayoutBlocks(paperId: PaperId): number {
    return this.withOp(() => layoutBlocksDao.deleteLayoutBlocks(this.db, paperId));
  }

  hasLayoutBlocks(paperId: PaperId): boolean {
    return this.withOp(() => layoutBlocksDao.hasLayoutBlocks(this.db, paperId));
  }

  insertSectionBoundaries(boundaries: layoutBlocksDao.SectionBoundaryRow[]): void {
    this.withOp(() => layoutBlocksDao.insertSectionBoundaries(this.db, boundaries));
  }

  getSectionBoundaries(paperId: PaperId): layoutBlocksDao.SectionBoundaryRow[] {
    return this.withOp(() => layoutBlocksDao.getSectionBoundaries(this.db, paperId));
  }

  deleteSectionBoundaries(paperId: PaperId): number {
    return this.withOp(() => layoutBlocksDao.deleteSectionBoundaries(this.db, paperId));
  }

  // ════════════════════════════════════════
  // §11.6 OCR 行级 bbox（文本层对齐）
  // ════════════════════════════════════════

  insertOcrLines(lines: ocrLinesDao.OcrLineRow[]): void {
    this.withOp(() => ocrLinesDao.insertOcrLines(this.db, lines));
  }

  getOcrLines(paperId: PaperId): ocrLinesDao.OcrLineRow[] {
    return this.withOp(() => ocrLinesDao.getOcrLines(this.db, paperId));
  }

  getOcrLinesByPage(paperId: PaperId, pageIndex: number): ocrLinesDao.OcrLineRow[] {
    return this.withOp(() => ocrLinesDao.getOcrLinesByPage(this.db, paperId, pageIndex));
  }

  hasOcrLines(paperId: PaperId): boolean {
    return this.withOp(() => ocrLinesDao.hasOcrLines(this.db, paperId));
  }

  deleteOcrLines(paperId: PaperId): number {
    return this.withOp(() => ocrLinesDao.deleteOcrLines(this.db, paperId));
  }

  // ════════════════════════════════════════
  // §12 快照
  // ════════════════════════════════════════

  /**
   * 创建快照。
   *
   * 注意：此方法包含异步 I/O（流式压缩），但不使用 withAsyncOp 跟踪 activeOps。
   * 调用方（Orchestrator）负责确保在 close() 前等待快照完成。
   * 同步的 DB 操作（checkpoint、统计收集）通过 withOp 隐式保护。
   */
  async createSnapshot(options?: { name?: string; reason?: string }): Promise<{
    snapshotPath: string;
    meta: snapshotMod.SnapshotMeta;
  }> {
    if (this.isClosing) {
      throw new DatabaseError({
        message: 'Database is closing, cannot accept new operations',
        context: { dbPath: this.dbPath, reason: 'closing' },
      });
    }
    const snapshotsDir = path.resolve(
      this.config.workspace.baseDir,
      this.config.workspace.snapshotsDir,
    );
    return snapshotMod.createSnapshot(this.db, snapshotsDir, this.logger, {
      ...options,
      pauseWorkerWrites: this.pauseWorkerWrites,
    });
  }

  listSnapshots(): Array<snapshotMod.SnapshotMeta & { filePath: string }> {
    const snapshotsDir = path.resolve(
      this.config.workspace.baseDir,
      this.config.workspace.snapshotsDir,
    );
    return snapshotMod.listSnapshots(snapshotsDir);
  }

  cleanupSnapshots(maxAutoSnapshots?: number): number {
    const snapshotsDir = path.resolve(
      this.config.workspace.baseDir,
      this.config.workspace.snapshotsDir,
    );
    return snapshotMod.cleanupSnapshots(snapshotsDir, maxAutoSnapshots, this.logger);
  }

  // ════════════════════════════════════════
  // 热迁移（运行时执行 Schema 变更）
  // ════════════════════════════════════════

  /**
   * Fix #5: 运行时执行 Schema 迁移。
   *
   * 与初始化时迁移不同，运行中迁移必须先释放全部 PreparedStatement 缓存，
   * 否则 DDL 语句（DROP TABLE / ALTER TABLE）会因 "database table is locked" 失败。
   * 迁移完成后重新 prepare。
   */
  runHotMigration(migrationsDir: string): void {
    // 步骤 1：释放全部预编译语句——防止 DDL 锁死
    this.stmts = releaseStatements(this.stmts);

    // 步骤 2：执行迁移
    try {
      runMigrations(this.db, migrationsDir, this.config, this.logger);
    } finally {
      // 步骤 3：重新预编译（无论迁移成功或失败都要恢复语句缓存）
      this.stmts = createStatements(this.db, true);
    }
  }

  // ════════════════════════════════════════
  // WAL & 生命周期
  // ════════════════════════════════════════

  /** 执行 WAL checkpoint (TRUNCATE)，含重试逻辑 + Worker 协调 */
  walCheckpoint(): void {
    walCheckpoint(this.db, {
      logger: this.logger,
      pauseWorkerWrites: this.pauseWorkerWrites,
    });
  }

  /**
   * §5.1 优雅关闭序列。
   *
   * 1. 设置 isClosing=true，后续操作立即抛出 DatabaseError
   * 2. 检查活跃操作（防御性断言）
   * 3. 终止 Worker Thread（如果已注入引用）
   * 4. WAL TRUNCATE checkpoint
   * 5. 释放预编译语句引用
   * 6. 关闭数据库连接
   * 7. 删除文件锁
   */
  close(): void {
    if (this.isClosing) return; // 防重入
    this.isClosing = true;

    // 步骤 2：检查活跃操作。
    // better-sqlite3 是同步 API——所有 DB 操作在同一事件循环 tick 中完成。
    // 如果能执行到 close()，说明当前没有同步 DB 操作在跑（V8 单线程保证）。
    // activeOps > 0 理论上不可能，此处仅作防御性断言。
    if (this.activeOps > 0) {
      this.logger.warn('Unexpected: closing with active operations', {
        activeOps: this.activeOps,
      });
    }

    // 步骤 3：终止 Worker Thread
    if (this.workerRef) {
      this.workerRef.terminate().catch((err) => {
        this.logger.warn('Worker terminate failed during close', {
          error: (err as Error).message,
        });
      });
      this.workerRef = undefined;
    }

    // 步骤 4：WAL TRUNCATE checkpoint（含 Worker 协调）
    try {
      walCheckpoint(this.db, {
        logger: this.logger,
        pauseWorkerWrites: this.pauseWorkerWrites,
      });
    } catch (err) {
      this.logger.warn('WAL checkpoint failed during close', {
        error: (err as Error).message,
      });
    }

    // 步骤 5：释放预编译语句引用
    this.stmts = releaseStatements(this.stmts);

    // 步骤 6：关闭数据库连接
    try {
      this.db.close();
    } catch (err) {
      this.logger.warn('Database close error', {
        error: (err as Error).message,
      });
    }

    // 步骤 7：删除文件锁
    this.fileLock.release();

    this.logger.info('Database closed successfully');
  }
}

// ═══ 工厂函数 ═══

export interface CreateDatabaseServiceOptions {
  dbPath: string;
  config: AbyssalConfig;
  logger: Logger;
  /** 只读模式，默认 false */
  readOnly?: boolean | undefined;
  /** 跳过 sqlite-vec 加载（测试用） */
  skipVecExtension?: boolean | undefined;
  /** 迁移 SQL 目录。默认为 __dirname/migrations（tsc 模式）。esbuild bundle 需要显式指定 */
  migrationsDir?: string | undefined;
}

/**
 * 创建并初始化 DatabaseService。
 *
 * 完整初始化序列 (§1.1):
 * 1. 打开连接 + PRAGMA
 * 2. 加载 sqlite-vec 扩展 + 验证
 * 3. Schema 迁移
 * 4. 预编译高频 SQL 语句
 * 5. 创建文件锁
 * 6. 返回 DatabaseService 实例
 */
export function createDatabaseService(
  options: CreateDatabaseServiceOptions,
): DatabaseService {
  const { dbPath, config, logger, readOnly = false, skipVecExtension } = options;

  // 步骤 1-2：打开连接 + PRAGMA + 扩展加载
  const db = openDatabase({
    dbPath,
    config,
    logger,
    readOnly,
    skipVecExtension,
  });

  // Wrap subsequent steps in try/catch — if migration or statement prep fails,
  // close the db connection to release file lock before re-throwing.
  try {
    // 步骤 3：Schema 迁移（只读模式跳过）
    if (!readOnly) {
      const migrationsDir = options.migrationsDir ?? path.resolve(__dirname, 'migrations');
      runMigrations(db, migrationsDir, config, logger, skipVecExtension);
    }

    // 步骤 4：预编译高频 SQL 语句
    const stmts = createStatements(db, !skipVecExtension);

    // 步骤 5：创建文件锁（只读模式跳过）
    const fileLock = new FileLock(dbPath);
    if (!readOnly) {
      fileLock.acquire();
    }

    logger.info('DatabaseService initialized', { dbPath, readOnly });

    return new DatabaseService(db, config, logger, dbPath, fileLock, stmts);
  } catch (err) {
    // Release the connection so the file lock is freed
    try { db.close(); } catch { /* ignore close errors */ }
    throw err;
  }
}
