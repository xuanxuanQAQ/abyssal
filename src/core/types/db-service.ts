/**
 * IDbService — DatabaseService 的公共接口契约
 *
 * 作为 DatabaseService 和 DbProxy 的编译期同步保证：
 * - DatabaseService implements IDbService → 少实现一个方法就报错
 * - DbProxy 的 Promisified<IDbService> → 调用方拼错方法名就报错
 *
 * 新增 DatabaseService 方法时，必须先在此接口声明。
 */

import type {
  PaperId, ConceptId, ChunkId, ArticleId, OutlineEntryId,
  MemoId, NoteId, AnnotationId, SuggestionId,
  PaginatedResult,
} from './common';
import type { PaperMetadata, PaperStatus } from './paper';
import type { ConceptDefinition } from './concept';
import type { ConceptMapping, RelationType, BilingualEvidence } from './mapping';
import type { Annotation } from './annotation';
import type { Article, ArticleAsset, OutlineEntry, SectionDraft } from './article';
import type { TextChunk } from './chunk';
import type { ResearchMemo } from './memo';
import type { ResearchNote } from './note';
import type { SuggestedConcept, SuggestionStatus } from './suggestion';
import type { PaperRelation } from './relation';
import type { SeedType } from './config';

import type { QueryPapersFilter } from '../database/dao/papers';
import type {
  UpdateConceptFields, GcConceptChangeResult,
  ConflictResolution, MergeConceptsResult, SplitConceptResult, SyncConceptsResult,
} from '../database/dao/concepts';
import type { ConceptMatrixEntry, AdjudicationDecision, ConceptStatsResult } from '../database/dao/mappings';
import type { SuggestedConceptsStatsResult } from '../database/dao/suggestions';
import type { MemoEntityType, AddMemoResult } from '../database/dao/memos';
import type { Seed } from '../database/dao/seeds';
import type { SearchLogEntry } from '../database/dao/search-log';
import type { SemanticSearchFn, GraphNode, GraphEdge, RelationGraphFilter } from '../database/dao/relations';
import type { DatabaseStats, IntegrityReport } from '../database/dao/stats';
import type { SnapshotMeta } from '../database/snapshot';
import type { ChatMessageRecord, ChatSessionSummary, PaginationOpts } from '../../shared-types/models';

export interface IDbService {
  // ─── 论文 ───
  addPaper(paper: PaperMetadata, status?: Partial<PaperStatus>): PaperId;
  updatePaper(id: PaperId, updates: Partial<PaperMetadata & PaperStatus>): number;
  getPaper(id: PaperId): (PaperMetadata & PaperStatus) | null;
  queryPapers(filter: QueryPapersFilter): PaginatedResult<PaperMetadata & PaperStatus>;
  deletePaper(id: PaperId, cascade?: boolean): number;
  resetAnalysis(id: PaperId): string | null;

  // ─── 引用 ───
  addCitation(citingId: PaperId, citedId: PaperId): void;
  addCitations(pairs: Array<{ citingId: PaperId; citedId: PaperId }>): void;
  getCitationsFrom(citingId: PaperId): PaperId[];
  getCitationsTo(citedId: PaperId): PaperId[];
  deleteCitation(citingId: PaperId, citedId: PaperId): number;

  // ─── 概念 ───
  addConcept(concept: ConceptDefinition): void;
  updateConcept(id: ConceptId, fields: UpdateConceptFields, isBreaking?: boolean): GcConceptChangeResult;
  deprecateConcept(id: ConceptId, reason: string): GcConceptChangeResult;
  syncConcepts(concepts: ConceptDefinition[], strategy: 'merge' | 'replace', isBreakingMap?: Record<string, boolean>): SyncConceptsResult;
  mergeConcepts(keepConceptId: ConceptId, mergeConceptId: ConceptId, conflictResolution?: ConflictResolution): MergeConceptsResult;
  splitConcept(originalConceptId: ConceptId, newConceptA: ConceptDefinition, newConceptB: ConceptDefinition): SplitConceptResult;
  gcConceptChange(conceptId: ConceptId, changeType: 'definition_refined' | 'deprecated' | 'deleted', isBreaking?: boolean): GcConceptChangeResult;
  getConcept(id: ConceptId): ConceptDefinition | null;
  getAllConcepts(includeDeprecated?: boolean): ConceptDefinition[];

  // ─── 映射 ───
  mapPaperConcept(mapping: ConceptMapping): void;
  mapPaperConceptBatch(mappings: ConceptMapping[]): void;
  updateMapping(paperId: PaperId, conceptId: ConceptId, updates: { relation?: RelationType; confidence?: number; evidence?: BilingualEvidence; reviewed?: boolean; reviewedAt?: string | null }): number;
  getMappingsByPaper(paperId: PaperId): ConceptMapping[];
  getMappingsByConcept(conceptId: ConceptId): ConceptMapping[];
  getMapping(paperId: PaperId, conceptId: ConceptId): ConceptMapping | null;
  deleteMapping(paperId: PaperId, conceptId: ConceptId): number;
  getConceptMatrix(): ConceptMatrixEntry[];
  adjudicateMapping(paperId: PaperId, conceptId: ConceptId, decision: AdjudicationDecision, revisions?: { relation?: RelationType; confidence?: number; note?: string }): number;
  countMappingsForConceptInPapers(conceptId: ConceptId, paperIds: string[]): number;
  getConceptMappingStats(conceptId: ConceptId): ConceptStatsResult;

  // ─── 分析完成（原子事务） ───
  completeAnalysis(paperId: PaperId, mappings: ConceptMapping[], status: 'completed' | 'failed', failureReason?: string | null, analysisPath?: string | null): void;

  // ─── 标注 ───
  addAnnotation(annotation: Omit<Annotation, 'id'>): AnnotationId;
  getAnnotations(paperId: PaperId): Annotation[];
  getAnnotation(id: AnnotationId): Annotation | null;
  updateAnnotation(id: AnnotationId, patch: import('../database/dao/annotations').AnnotationPatch): number;
  deleteAnnotation(id: AnnotationId): number;
  getAnnotationsByConcept(conceptId: ConceptId): Annotation[];
  countAnnotationsForPaperConcept(paperId: PaperId, conceptId: ConceptId): number;

  // ─── 搜索历史 ───
  listDiscoverRuns(): import('../../shared-types/models').DiscoverRun[];
  addDiscoverRun(run: { id: string; query: string; resultCount: number }): void;

  // ─── 种子 ───
  addSeed(paperId: PaperId, seedType: SeedType): void;
  getSeeds(): Seed[];
  removeSeed(paperId: PaperId): number;

  // ─── 检索日志 ───
  addSearchLog(query: string, apiSource: string, resultCount: number): number;
  getSearchLog(limit?: number): SearchLogEntry[];

  // ─── 文本块 ───
  insertChunkTextOnly(chunk: TextChunk): number;
  insertChunksTextOnlyBatch(chunks: TextChunk[]): number[];
  insertChunkVectors(rowids: number[], embeddings: Float32Array[]): void;
  insertChunk(chunk: TextChunk, embedding: Float32Array | null): number;
  insertChunksBatch(chunks: TextChunk[], embeddings: (Float32Array | null)[]): number[];
  deleteChunksByPaper(paperId: PaperId): number;
  deleteChunksByPrefix(prefix: string): number;
  getChunksByPaper(paperId: PaperId): TextChunk[];
  getChunkByChunkId(chunkId: ChunkId): TextChunk | null;

  // ─── Memo ───
  addMemo(memo: Omit<ResearchMemo, 'id' | 'createdAt' | 'updatedAt'>, embedding: Float32Array | null): AddMemoResult;
  markMemoIndexed(id: MemoId): void;
  updateMemo(id: MemoId, updates: Partial<Pick<ResearchMemo, 'text' | 'paperIds' | 'conceptIds' | 'annotationId' | 'outlineId' | 'linkedNoteIds' | 'tags'>>, newEmbedding?: Float32Array | null): number;
  getMemosByEntity(entityType: MemoEntityType, entityId: string | number): ResearchMemo[];
  queryMemos(filter?: { paperIds?: string[]; conceptIds?: string[]; tags?: string[]; searchText?: string; limit?: number; offset?: number }): ResearchMemo[];
  getMemo(id: MemoId): ResearchMemo | null;
  deleteMemo(id: MemoId): number;

  // ─── 笔记 ───
  createNote(note: Omit<ResearchNote, 'createdAt' | 'updatedAt'>, chunks: TextChunk[], embeddings: (Float32Array | null)[]): void;
  onNoteFileChanged(noteId: NoteId, frontmatter: { title: string; linkedPaperIds: PaperId[]; linkedConceptIds: ConceptId[]; tags: string[] }, newChunks: TextChunk[], newEmbeddings: (Float32Array | null)[]): void;
  linkMemoToNote(memoId: MemoId, noteId: NoteId): void;
  linkNoteToConcept(noteId: NoteId, conceptId: ConceptId): void;
  updateNoteMeta(id: NoteId, updates: Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>): ResearchNote | null;
  queryNotes(filter?: { conceptIds?: string[]; paperIds?: string[]; tags?: string[]; searchText?: string }): ResearchNote[];
  getNote(id: NoteId): ResearchNote | null;
  getNoteByFilePath(filePath: string): ResearchNote | null;
  getAllNotes(): ResearchNote[];
  deleteNote(id: NoteId): number;

  // ─── 概念建议 ───
  addSuggestedConcept(input: { term: string; frequencyInPaper: number; sourcePaperId: PaperId; closestExistingConceptId?: ConceptId | null; closestExistingConceptSimilarity?: string | null; reason: string }): SuggestionId;
  adoptSuggestedConcept(suggestionId: SuggestionId, conceptOverrides?: Partial<ConceptDefinition>): ConceptId;
  dismissSuggestedConcept(suggestionId: SuggestionId): number;
  getSuggestedConcepts(status?: SuggestionStatus, limit?: number): SuggestedConcept[];
  getSuggestedConcept(id: SuggestionId): SuggestedConcept | null;
  restoreSuggestedConcept(suggestionId: SuggestionId): number;
  getSuggestedConceptsStats(): SuggestedConceptsStatsResult;

  // ─── 文章 ───
  createArticle(article: Omit<Article, 'createdAt' | 'updatedAt'>): ArticleId;
  getArticle(id: ArticleId): Article | null;
  updateArticle(id: ArticleId, updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status'>>): number;
  getAllArticles(): Article[];
  deleteArticle(id: ArticleId): number;
  setOutline(articleId: ArticleId, entries: OutlineEntry[]): void;
  getOutline(articleId: ArticleId): OutlineEntry[];
  getOutlineEntry(id: OutlineEntryId): OutlineEntry | null;
  updateOutlineEntry(id: OutlineEntryId, updates: Partial<Pick<OutlineEntry, 'title' | 'coreArgument' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status' | 'sortOrder'>>): number;
  markOutlineEntryDeleted(id: OutlineEntryId): number;
  searchSections(query: string): Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }>;
  addSectionDraft(outlineEntryId: OutlineEntryId, content: string, llmBackend: string): number;
  getSectionDrafts(outlineEntryId: OutlineEntryId): SectionDraft[];
  markEditedParagraphs(outlineEntryId: OutlineEntryId, version: number, paragraphIndices: number[]): number;

  // ─── 全文档操作 ───
  getFullDocument(articleId: ArticleId): Array<{ sectionId: string; title: string; content: string; documentJson: string | null; version: number; sortIndex: number; parentId: string | null; depth: number }>;
  saveDocumentSections(articleId: ArticleId, sections: Array<{ sectionId: string; title?: string; content: string; documentJson?: string | null; source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' }>): void;
  cleanupVersions(articleId: ArticleId, keepCount: number): number;

  // ─── 文章资产 ───
  addArticleAsset(asset: ArticleAsset): void;
  getArticleAssets(articleId: ArticleId): ArticleAsset[];
  getArticleAsset(assetId: string): ArticleAsset | null;
  deleteArticleAsset(assetId: string): number;

  // ─── 关系 ───
  computeRelationsForPaper(paperId: PaperId, semanticSearchFn: SemanticSearchFn | null): void;
  recomputeAllRelations(semanticSearchFn: SemanticSearchFn | null): number;
  getRelationGraph(filter: RelationGraphFilter): { nodes: GraphNode[]; edges: GraphEdge[] };
  getRelationsForPaper(paperId: PaperId): PaperRelation[];

  // ─── 聊天持久化 ───
  saveChatMessage(record: ChatMessageRecord): void;
  getChatHistory(contextKey: string, opts?: PaginationOpts): ChatMessageRecord[];
  deleteChatSession(contextKey: string): void;
  listChatSessions(): ChatSessionSummary[];

  // ─── 统计 ───
  getStats(): DatabaseStats;
  checkIntegrity(): IntegrityReport;

  // ─── 文件路径 ───
  getPaperFilePaths(paperId: PaperId): string[];
  getPaperFigureDir(paperId: PaperId): string;

  // ─── 快照 ───
  createSnapshot(options?: { name?: string; reason?: string }): Promise<{ snapshotPath: string; meta: SnapshotMeta }>;
  listSnapshots(): Array<SnapshotMeta & { filePath: string }>;
  cleanupSnapshots(maxAutoSnapshots?: number): number;

  // ─── 热迁移 / WAL ───
  runHotMigration(migrationsDir: string): void;
  walCheckpoint(): void;
}

/**
 * 将 IDbService 的所有方法返回类型包装为 Promise。
 * 用于 DbProxy 的类型声明——所有 RPC 调用都是 async 的。
 */
export type AsyncDbService = {
  [K in keyof IDbService]: IDbService[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : IDbService[K];
};
