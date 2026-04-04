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
  PaperId, ConceptId, ChunkId, ArticleId, OutlineEntryId, DraftId,
  MemoId, NoteId, AnnotationId, SuggestionId,
  PaginatedResult,
} from './common';
import type { PaperMetadata, PaperStatus } from './paper';
import type { ConceptDefinition } from './concept';
import type { ConceptMapping, RelationType, BilingualEvidence } from './mapping';
import type { Annotation } from './annotation';
import type { Article, ArticleAsset, Draft, DraftSectionMeta, DraftVersion, OutlineEntry, SectionDraft } from './article';
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
  saveNoteContent(noteId: NoteId, documentJson: string, chunks: TextChunk[], embeddings: (Float32Array | null)[]): void;
  linkMemoToNote(memoId: MemoId, noteId: NoteId): void;
  linkNoteToConcept(noteId: NoteId, conceptId: ConceptId): void;
  updateNoteMeta(id: NoteId, updates: Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>): ResearchNote | null;
  queryNotes(filter?: { conceptIds?: string[]; paperIds?: string[]; tags?: string[]; searchText?: string }): ResearchNote[];
  getNote(id: NoteId): ResearchNote | null;
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
  updateArticle(id: ArticleId, updates: Partial<Pick<Article, 'title' | 'style' | 'cslStyleId' | 'outputLanguage' | 'status' | 'documentJson' | 'abstract' | 'keywords' | 'authors' | 'targetWordCount'>>): number;
  getAllArticles(): Article[];
  deleteArticle(id: ArticleId): number;
  getArticleDocument(articleId: ArticleId): { articleId: ArticleId; documentJson: string; updatedAt: string };
  saveArticleDocument(articleId: ArticleId, documentJson: string, source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite'): void;
  setOutline(articleId: ArticleId, entries: OutlineEntry[]): void;
  getOutline(articleId: ArticleId): OutlineEntry[];
  listDraftsByArticle(articleId: ArticleId): Draft[];
  getDraft(id: DraftId): Draft | null;
  createDraft(draft: Omit<Draft, 'createdAt' | 'updatedAt'>): DraftId;
  updateDraft(id: DraftId, updates: Partial<Pick<Draft, 'title' | 'status' | 'language' | 'audience' | 'writingStyle' | 'cslStyleId' | 'abstract' | 'keywords' | 'targetWordCount' | 'lastOpenedAt'>>): number;
  deleteDraft(id: DraftId): number;
  getDraftDocument(draftId: DraftId): { draftId: DraftId; articleId: ArticleId; documentJson: string; updatedAt: string };
  saveDraftDocument(draftId: DraftId, documentJson: string, source: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate'): void;
  getDraftSections(draftId: DraftId): Array<{ sectionId: string; title: string; parentId: string | null; sortIndex: number; depth: number; wordCount: number; lineageId: string; basedOnSectionId: string | null; status: string; writingInstruction: string | null; conceptIds: string[]; paperIds: string[]; aiModel: string | null; evidenceStatus: string | null; evidenceGaps: string[] }>;
  getDraftSectionMeta(draftId: DraftId): DraftSectionMeta[];
  updateDraftSectionMeta(draftId: DraftId, sectionId: string, patch: Partial<Pick<DraftSectionMeta, 'lineageId' | 'basedOnSectionId' | 'status' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'aiModel' | 'evidenceStatus' | 'evidenceGaps'>>): number;
  updateDraftSectionContent(draftId: DraftId, sectionId: string, content: string, documentJson?: string | null, source?: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite' | 'ai-derive-draft' | 'duplicate'): void;
  getDraftVersions(draftId: DraftId): DraftVersion[];
  restoreDraftVersion(draftId: DraftId, version: number): void;
  createDraftFromVersion(draftId: DraftId, version: number, title: string): DraftId;
  getOutlineEntry(id: OutlineEntryId): OutlineEntry | null;
  updateOutlineEntry(id: OutlineEntryId, updates: Partial<Pick<OutlineEntry, 'title' | 'coreArgument' | 'writingInstruction' | 'conceptIds' | 'paperIds' | 'status' | 'sortOrder'>>): number;
  markOutlineEntryDeleted(id: OutlineEntryId): number;
  searchSections(query: string): Array<{ outlineEntryId: OutlineEntryId; articleId: ArticleId; title: string; snippet: string }>;
  addSectionDraft(outlineEntryId: OutlineEntryId, content: string, llmBackend: string, source?: 'manual' | 'auto' | 'ai-generate' | 'ai-rewrite', documentJson?: string | null): number;
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

  // ─── LLM 审计日志 ───
  insertAuditLog(entry: {
    workflowId?: string | null;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    costUsd?: number | null;
    paperId?: string | null;
    finishReason?: string | null;
  }): number;

  // ─── 会话状态持久化 ───
  saveSessionMemory(entries: Array<{
    id: string; type: string; content: string; source: string;
    linked_entities: string; importance: number;
    created_at: number; last_accessed_at: number; tags: string | null;
  }>): void;
  loadSessionMemory(): Array<{
    id: string; type: string; content: string; source: string;
    linked_entities: string; importance: number;
    created_at: number; last_accessed_at: number; tags: string | null;
  }>;
  saveSessionConversation(key: string, messagesJson: string): void;
  loadSessionConversation(key: string): string | null;

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

/**
 * IDbService 的全部方法名集合（运行时）。
 *
 * 使用 Record<keyof IDbService, true> 保证编译期同步：
 * - IDbService 新增方法 → 此处缺少对应 key → TS 报错
 * - IDbService 删除方法 → 此处多余 key → TS 报错
 *
 * 被 DbProxy 的 Proxy get-trap 用于区分"合法 RPC 方法"与"不存在的属性"。
 */
const _dbServiceMethodMap: Record<keyof IDbService, true> = {
  // 论文
  addPaper: true, updatePaper: true, getPaper: true, queryPapers: true,
  deletePaper: true, resetAnalysis: true,
  // 引用
  addCitation: true, addCitations: true, getCitationsFrom: true,
  getCitationsTo: true, deleteCitation: true,
  // 概念
  addConcept: true, updateConcept: true, deprecateConcept: true,
  syncConcepts: true, mergeConcepts: true, splitConcept: true,
  gcConceptChange: true, getConcept: true, getAllConcepts: true,
  // 映射
  mapPaperConcept: true, mapPaperConceptBatch: true, updateMapping: true,
  getMappingsByPaper: true, getMappingsByConcept: true, getMapping: true,
  deleteMapping: true, getConceptMatrix: true, adjudicateMapping: true,
  countMappingsForConceptInPapers: true, getConceptMappingStats: true,
  // 分析
  completeAnalysis: true,
  // 标注
  addAnnotation: true, getAnnotations: true, getAnnotation: true,
  updateAnnotation: true, deleteAnnotation: true,
  getAnnotationsByConcept: true, countAnnotationsForPaperConcept: true,
  // 搜索历史
  listDiscoverRuns: true, addDiscoverRun: true,
  // 种子
  addSeed: true, getSeeds: true, removeSeed: true,
  // 检索日志
  addSearchLog: true, getSearchLog: true,
  // 文本块
  insertChunkTextOnly: true, insertChunksTextOnlyBatch: true,
  insertChunkVectors: true, insertChunk: true, insertChunksBatch: true,
  deleteChunksByPaper: true, deleteChunksByPrefix: true,
  getChunksByPaper: true, getChunkByChunkId: true,
  // Memo
  addMemo: true, markMemoIndexed: true, updateMemo: true,
  getMemosByEntity: true, queryMemos: true, getMemo: true, deleteMemo: true,
  // 笔记
  createNote: true, saveNoteContent: true, linkMemoToNote: true,
  linkNoteToConcept: true, updateNoteMeta: true, queryNotes: true,
  getNote: true, getAllNotes: true, deleteNote: true,
  // 概念建议
  addSuggestedConcept: true, adoptSuggestedConcept: true,
  dismissSuggestedConcept: true, getSuggestedConcepts: true,
  getSuggestedConcept: true, restoreSuggestedConcept: true,
  getSuggestedConceptsStats: true,
  // 文章
  createArticle: true, getArticle: true, updateArticle: true,
  getAllArticles: true, deleteArticle: true, getArticleDocument: true,
  saveArticleDocument: true, setOutline: true,
  getOutline: true, listDraftsByArticle: true, getDraft: true,
  createDraft: true, updateDraft: true, deleteDraft: true,
  getDraftDocument: true, saveDraftDocument: true,
  getDraftSections: true, getDraftSectionMeta: true,
  updateDraftSectionMeta: true, updateDraftSectionContent: true,
  getDraftVersions: true, restoreDraftVersion: true,
  createDraftFromVersion: true, getOutlineEntry: true, updateOutlineEntry: true,
  markOutlineEntryDeleted: true, searchSections: true,
  addSectionDraft: true, getSectionDrafts: true, markEditedParagraphs: true,
  // 全文档
  getFullDocument: true, saveDocumentSections: true, cleanupVersions: true,
  // 文章资产
  addArticleAsset: true, getArticleAssets: true, getArticleAsset: true,
  deleteArticleAsset: true,
  // 关系
  computeRelationsForPaper: true, recomputeAllRelations: true,
  getRelationGraph: true, getRelationsForPaper: true,
  // 聊天
  saveChatMessage: true, getChatHistory: true, deleteChatSession: true,
  listChatSessions: true,
  // 审计
  insertAuditLog: true,
  // 会话状态
  saveSessionMemory: true, loadSessionMemory: true,
  saveSessionConversation: true, loadSessionConversation: true,
  // 统计
  getStats: true, checkIntegrity: true,
  // 文件路径
  getPaperFilePaths: true, getPaperFigureDir: true,
  // 快照
  createSnapshot: true, listSnapshots: true, cleanupSnapshots: true,
  // 热迁移 / WAL
  runHotMigration: true, walCheckpoint: true,
};

export const DB_SERVICE_METHODS: ReadonlySet<string> = new Set(Object.keys(_dbServiceMethodMap));
