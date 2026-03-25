// ═══ Database Module — 公共接口 ═══
//
// database 模块是 Abyssal 系统的最底层状态持有者。
// 对外暴露 DatabaseService 类和 createDatabaseService 工厂函数。

import type Database from 'better-sqlite3';
import * as path from 'node:path';

import type { AbyssalConfig } from '../types/config';
import type { Logger } from '../infra/logger';
import type {
  PaperId, ConceptId, ChunkId, ArticleId, OutlineEntryId,
  MemoId, NoteId, AnnotationId, SuggestionId,
  PaginatedResult, SortSpec,
} from '../types/common';
import type { PaperMetadata, PaperStatus, FulltextStatus, AnalysisStatus, Relevance, PaperType, PaperSource } from '../types/paper';
import type { ConceptDefinition, ConceptMaturity } from '../types/concept';
import type { ConceptMapping, RelationType, BilingualEvidence } from '../types/mapping';
import type { Annotation } from '../types/annotation';
import type { Article, OutlineEntry, SectionDraft } from '../types/article';
import type { TextChunk } from '../types/chunk';
import type { ResearchMemo } from '../types/memo';
import type { ResearchNote } from '../types/note';
import type { SuggestedConcept, SuggestionStatus } from '../types/suggestion';
import type { PaperRelation, RelationEdgeType } from '../types/relation';
import type { SeedType } from '../types/config';

// ─── 连接 & 迁移 ───
import { openDatabase, walCheckpoint } from './connection';
import { runMigrations } from './migration';

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
import * as relationsDao from './dao/relations';
import * as statsDao from './dao/stats';

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
export type { SnapshotMeta } from './snapshot';

// ═══ DatabaseService ═══

export class DatabaseService {
  private readonly db: Database.Database;
  private readonly config: AbyssalConfig;
  private readonly logger: Logger;

  constructor(db: Database.Database, config: AbyssalConfig, logger: Logger) {
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  /** 获取底层 better-sqlite3 实例（仅供高级用途） */
  get raw(): Database.Database {
    return this.db;
  }

  // ════════════════════════════════════════
  // §3 论文 CRUD
  // ════════════════════════════════════════

  addPaper(paper: PaperMetadata, status?: Partial<PaperStatus>): PaperId {
    return papersDao.addPaper(this.db, paper, status);
  }

  updatePaper(id: PaperId, updates: Partial<PaperMetadata & PaperStatus>): number {
    return papersDao.updatePaper(this.db, id, updates);
  }

  getPaper(id: PaperId): (PaperMetadata & PaperStatus) | null {
    return papersDao.getPaper(this.db, id);
  }

  queryPapers(filter: papersDao.QueryPapersFilter): PaginatedResult<PaperMetadata & PaperStatus> {
    return papersDao.queryPapers(this.db, filter);
  }

  deletePaper(id: PaperId, cascade: boolean = true): number {
    return papersDao.deletePaper(this.db, id, cascade);
  }

  // ════════════════════════════════════════
  // 引用关系
  // ════════════════════════════════════════

  addCitation(citingId: PaperId, citedId: PaperId): void {
    citationsDao.addCitation(this.db, citingId, citedId);
  }

  addCitations(pairs: Array<{ citingId: PaperId; citedId: PaperId }>): void {
    citationsDao.addCitations(this.db, pairs);
  }

  getCitationsFrom(citingId: PaperId): PaperId[] {
    return citationsDao.getCitationsFrom(this.db, citingId);
  }

  getCitationsTo(citedId: PaperId): PaperId[] {
    return citationsDao.getCitationsTo(this.db, citedId);
  }

  deleteCitation(citingId: PaperId, citedId: PaperId): number {
    return citationsDao.deleteCitation(this.db, citingId, citedId);
  }

  // ════════════════════════════════════════
  // §4 概念框架
  // ════════════════════════════════════════

  addConcept(concept: ConceptDefinition): void {
    conceptsDao.addConcept(this.db, concept);
  }

  updateConcept(
    id: ConceptId,
    fields: conceptsDao.UpdateConceptFields,
    isBreaking: boolean = false,
  ): conceptsDao.GcConceptChangeResult {
    return conceptsDao.updateConcept(
      this.db, id, fields, isBreaking,
      this.config.concepts.additiveChangeLookbackDays,
    );
  }

  deprecateConcept(id: ConceptId, reason: string): conceptsDao.GcConceptChangeResult {
    return conceptsDao.deprecateConcept(this.db, id, reason);
  }

  syncConcepts(
    concepts: ConceptDefinition[],
    strategy: 'merge' | 'replace',
    isBreakingMap?: Record<string, boolean>,
  ): conceptsDao.SyncConceptsResult {
    return conceptsDao.syncConcepts(
      this.db, concepts, strategy, isBreakingMap,
      this.config.concepts.additiveChangeLookbackDays,
    );
  }

  mergeConcepts(
    keepConceptId: ConceptId,
    mergeConceptId: ConceptId,
    conflictResolution?: conceptsDao.ConflictResolution,
  ): conceptsDao.MergeConceptsResult {
    return conceptsDao.mergeConcepts(this.db, keepConceptId, mergeConceptId, conflictResolution);
  }

  splitConcept(
    originalConceptId: ConceptId,
    newConceptA: ConceptDefinition,
    newConceptB: ConceptDefinition,
  ): conceptsDao.SplitConceptResult {
    return conceptsDao.splitConcept(this.db, originalConceptId, newConceptA, newConceptB);
  }

  gcConceptChange(
    conceptId: ConceptId,
    changeType: 'definition_refined' | 'deprecated' | 'deleted',
    isBreaking?: boolean,
  ): conceptsDao.GcConceptChangeResult {
    return conceptsDao.gcConceptChange(
      this.db, conceptId, changeType, isBreaking,
      this.config.concepts.additiveChangeLookbackDays,
    );
  }

  getConcept(id: ConceptId): ConceptDefinition | null {
    return conceptsDao.getConcept(this.db, id);
  }

  getAllConcepts(includeDeprecated?: boolean): ConceptDefinition[] {
    return conceptsDao.getAllConcepts(this.db, includeDeprecated);
  }

  // ════════════════════════════════════════
  // 论文-概念映射
  // ════════════════════════════════════════

  mapPaperConcept(mapping: ConceptMapping): void {
    mappingsDao.mapPaperConcept(this.db, mapping);
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
    return mappingsDao.updateMapping(this.db, paperId, conceptId, updates);
  }

  getMappingsByPaper(paperId: PaperId): ConceptMapping[] {
    return mappingsDao.getMappingsByPaper(this.db, paperId);
  }

  getMappingsByConcept(conceptId: ConceptId): ConceptMapping[] {
    return mappingsDao.getMappingsByConcept(this.db, conceptId);
  }

  getMapping(paperId: PaperId, conceptId: ConceptId): ConceptMapping | null {
    return mappingsDao.getMapping(this.db, paperId, conceptId);
  }

  deleteMapping(paperId: PaperId, conceptId: ConceptId): number {
    return mappingsDao.deleteMapping(this.db, paperId, conceptId);
  }

  getConceptMatrix(): mappingsDao.ConceptMatrixEntry[] {
    return mappingsDao.getConceptMatrix(this.db);
  }

  // ════════════════════════════════════════
  // 标注
  // ════════════════════════════════════════

  addAnnotation(annotation: Omit<Annotation, 'id'>): AnnotationId {
    return annotationsDao.addAnnotation(this.db, annotation);
  }

  getAnnotations(paperId: PaperId): Annotation[] {
    return annotationsDao.getAnnotations(this.db, paperId);
  }

  getAnnotation(id: AnnotationId): Annotation | null {
    return annotationsDao.getAnnotation(this.db, id);
  }

  deleteAnnotation(id: AnnotationId): number {
    return annotationsDao.deleteAnnotation(this.db, id);
  }

  getAnnotationsByConcept(conceptId: ConceptId): Annotation[] {
    return annotationsDao.getAnnotationsByConcept(this.db, conceptId);
  }

  // ════════════════════════════════════════
  // 种子论文
  // ════════════════════════════════════════

  addSeed(paperId: PaperId, seedType: SeedType): void {
    seedsDao.addSeed(this.db, paperId, seedType);
  }

  getSeeds(): seedsDao.Seed[] {
    return seedsDao.getSeeds(this.db);
  }

  removeSeed(paperId: PaperId): number {
    return seedsDao.removeSeed(this.db, paperId);
  }

  // ════════════════════════════════════════
  // 检索日志
  // ════════════════════════════════════════

  addSearchLog(query: string, apiSource: string, resultCount: number): number {
    return searchLogDao.addSearchLog(this.db, query, apiSource, resultCount);
  }

  getSearchLog(limit?: number): searchLogDao.SearchLogEntry[] {
    return searchLogDao.getSearchLog(this.db, limit);
  }

  // ════════════════════════════════════════
  // 文本块 + 向量
  // ════════════════════════════════════════

  // Phase 1：仅写入文本（主线程安全，不阻塞 UI）
  insertChunkTextOnly(chunk: TextChunk): number {
    return chunksDao.insertChunkTextOnly(this.db, chunk);
  }

  insertChunksTextOnlyBatch(chunks: TextChunk[]): number[] {
    return chunksDao.insertChunksTextOnlyBatch(this.db, chunks);
  }

  // Phase 2：仅写入向量（设计用于 Worker Thread 独立连接）
  insertChunkVectors(rowids: number[], embeddings: Float32Array[]): void {
    chunksDao.insertChunkVectors(this.db, rowids, embeddings);
  }

  // 便捷：chunk + 向量一次写入（小数据量场景）
  insertChunk(chunk: TextChunk, embedding: Float32Array | null): number {
    return chunksDao.insertChunk(this.db, chunk, embedding);
  }

  insertChunksBatch(chunks: TextChunk[], embeddings: (Float32Array | null)[]): number[] {
    return chunksDao.insertChunksBatch(this.db, chunks, embeddings);
  }

  deleteChunksByPaper(paperId: PaperId): number {
    return chunksDao.deleteChunksByPaper(this.db, paperId);
  }

  deleteChunksByPrefix(prefix: string): number {
    return chunksDao.deleteChunksByPrefix(this.db, prefix);
  }

  getChunksByPaper(paperId: PaperId): TextChunk[] {
    return chunksDao.getChunksByPaper(this.db, paperId);
  }

  getChunkByChunkId(chunkId: ChunkId): TextChunk | null {
    return chunksDao.getChunkByChunkId(this.db, chunkId);
  }

  // ════════════════════════════════════════
  // §5 碎片笔记
  // ════════════════════════════════════════

  addMemo(
    memo: Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>,
    embedding: Float32Array | null,
  ): memosDao.AddMemoResult {
    return memosDao.addMemo(this.db, memo, embedding);
  }

  markMemoIndexed(id: MemoId): void {
    memosDao.markMemoIndexed(this.db, id);
  }

  updateMemo(
    id: MemoId,
    updates: Partial<Pick<ResearchMemo, 'text' | 'paperIds' | 'conceptIds' | 'annotationId' | 'outlineId' | 'linkedNoteIds' | 'tags'>>,
    newEmbedding?: Float32Array | null,
  ): number {
    return memosDao.updateMemo(this.db, id, updates, newEmbedding);
  }

  getMemosByEntity(entityType: memosDao.MemoEntityType, entityId: string | number): ResearchMemo[] {
    return memosDao.getMemosByEntity(this.db, entityType, entityId);
  }

  getMemo(id: MemoId): ResearchMemo | null {
    return memosDao.getMemo(this.db, id);
  }

  deleteMemo(id: MemoId): number {
    return memosDao.deleteMemo(this.db, id);
  }

  // ════════════════════════════════════════
  // §6 结构化笔记
  // ════════════════════════════════════════

  createNote(
    note: Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
    chunks: TextChunk[],
    embeddings: (Float32Array | null)[],
  ): void {
    notesDao.createNote(this.db, note, chunks, embeddings);
  }

  onNoteFileChanged(
    noteId: NoteId,
    frontmatter: {
      title: string;
      linkedPaperIds: PaperId[];
      linkedConceptIds: ConceptId[];
      tags: string[];
    },
    newChunks: TextChunk[],
    newEmbeddings: (Float32Array | null)[],
  ): void {
    notesDao.onNoteFileChanged(this.db, noteId, frontmatter, newChunks, newEmbeddings);
  }

  linkMemoToNote(memoId: MemoId, noteId: NoteId): void {
    notesDao.linkMemoToNote(this.db, memoId, noteId);
  }

  linkNoteToConcept(noteId: NoteId, conceptId: ConceptId): void {
    notesDao.linkNoteToConcept(this.db, noteId, conceptId);
  }

  getNote(id: NoteId): ResearchNote | null {
    return notesDao.getNote(this.db, id);
  }

  getNoteByFilePath(filePath: string): ResearchNote | null {
    return notesDao.getNoteByFilePath(this.db, filePath);
  }

  getAllNotes(): ResearchNote[] {
    return notesDao.getAllNotes(this.db);
  }

  deleteNote(id: NoteId): number {
    return notesDao.deleteNote(this.db, id);
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
    return suggestionsDao.addSuggestedConcept(this.db, input);
  }

  adoptSuggestedConcept(
    suggestionId: SuggestionId,
    conceptOverrides?: Partial<ConceptDefinition>,
  ): ConceptId {
    return suggestionsDao.adoptSuggestedConcept(this.db, suggestionId, conceptOverrides);
  }

  dismissSuggestedConcept(suggestionId: SuggestionId): number {
    return suggestionsDao.dismissSuggestedConcept(this.db, suggestionId);
  }

  getSuggestedConcepts(status?: SuggestionStatus, limit?: number): SuggestedConcept[] {
    return suggestionsDao.getSuggestedConcepts(this.db, status, limit);
  }

  getSuggestedConcept(id: SuggestionId): SuggestedConcept | null {
    return suggestionsDao.getSuggestedConcept(this.db, id);
  }

  // ════════════════════════════════════════
  // §8 文章 / 纲要 / 草稿
  // ════════════════════════════════════════

  createArticle(article: Omit<Article, 'createdAt' | 'updatedAt'>): ArticleId {
    return articlesDao.createArticle(this.db, article);
  }

  getArticle(id: ArticleId): Article | null {
    return articlesDao.getArticle(this.db, id);
  }

  updateArticle(
    id: ArticleId,
    updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status'>>,
  ): number {
    return articlesDao.updateArticle(this.db, id, updates);
  }

  getAllArticles(): Article[] {
    return articlesDao.getAllArticles(this.db);
  }

  deleteArticle(id: ArticleId): number {
    return articlesDao.deleteArticle(this.db, id);
  }

  setOutline(articleId: ArticleId, entries: OutlineEntry[]): void {
    articlesDao.setOutline(this.db, articleId, entries);
  }

  getOutline(articleId: ArticleId): OutlineEntry[] {
    return articlesDao.getOutline(this.db, articleId);
  }

  addSectionDraft(outlineEntryId: OutlineEntryId, content: string, llmBackend: string): number {
    return articlesDao.addSectionDraft(this.db, outlineEntryId, content, llmBackend);
  }

  getSectionDrafts(outlineEntryId: OutlineEntryId): SectionDraft[] {
    return articlesDao.getSectionDrafts(this.db, outlineEntryId);
  }

  markEditedParagraphs(outlineEntryId: OutlineEntryId, version: number, paragraphIndices: number[]): number {
    return articlesDao.markEditedParagraphs(this.db, outlineEntryId, version, paragraphIndices);
  }

  // ════════════════════════════════════════
  // §9 派生关系
  // ════════════════════════════════════════

  computeRelationsForPaper(
    paperId: PaperId,
    semanticSearchFn: relationsDao.SemanticSearchFn | null,
  ): void {
    relationsDao.computeRelationsForPaper(this.db, paperId, semanticSearchFn);
  }

  recomputeAllRelations(semanticSearchFn: relationsDao.SemanticSearchFn | null): number {
    return relationsDao.recomputeAllRelations(this.db, semanticSearchFn);
  }

  getRelationGraph(filter: relationsDao.RelationGraphFilter): { nodes: relationsDao.GraphNode[]; edges: relationsDao.GraphEdge[] } {
    return relationsDao.getRelationGraph(this.db, filter);
  }

  getRelationsForPaper(paperId: PaperId): PaperRelation[] {
    return relationsDao.getRelationsForPaper(this.db, paperId);
  }

  // ════════════════════════════════════════
  // §10 统计与完整性
  // ════════════════════════════════════════

  getStats(): statsDao.DatabaseStats {
    return statsDao.getStats(this.db);
  }

  checkIntegrity(): statsDao.IntegrityReport {
    return statsDao.checkIntegrity(this.db);
  }

  // ════════════════════════════════════════
  // §12 快照
  // ════════════════════════════════════════

  createSnapshot(options?: { name?: string; reason?: string }): {
    snapshotPath: string;
    meta: snapshotMod.SnapshotMeta;
  } {
    const snapshotsDir = path.resolve(
      this.config.workspace.baseDir,
      this.config.workspace.snapshotsDir,
    );
    return snapshotMod.createSnapshot(this.db, snapshotsDir, this.logger, options);
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
  // WAL & 生命周期
  // ════════════════════════════════════════

  /** 执行 WAL checkpoint (TRUNCATE) */
  walCheckpoint(): void {
    walCheckpoint(this.db);
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
    this.logger.info('Database connection closed');
  }
}

// ═══ 工厂函数 ═══

export interface CreateDatabaseServiceOptions {
  dbPath: string;
  config: AbyssalConfig;
  logger: Logger;
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
 * 2. 加载 sqlite-vec 扩展
 * 3. Schema 迁移
 * 4. 返回 DatabaseService 实例
 */
export function createDatabaseService(
  options: CreateDatabaseServiceOptions,
): DatabaseService {
  const { dbPath, config, logger, skipVecExtension } = options;

  // 步骤 1-3：打开连接 + PRAGMA + 扩展加载
  const db = openDatabase({
    dbPath,
    config,
    logger,
    skipVecExtension,
  });

  // 步骤 4：Schema 迁移
  const migrationsDir = options.migrationsDir ?? path.resolve(__dirname, 'migrations');
  runMigrations(db, migrationsDir, config, logger, skipVecExtension);

  logger.info('DatabaseService initialized', { dbPath });

  return new DatabaseService(db, config, logger);
}
