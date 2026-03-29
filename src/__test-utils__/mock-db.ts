/**
 * Database mock —— 单元测试用全 mock。
 *
 * 集成测试请使用 test-db.ts 的 createTestDB()（基于真实 migration）。
 */
import { vi } from 'vitest';

/**
 * 创建 IDbService 的全 mock。
 *
 * 覆盖 IDbService 全部方法分组，默认返回合理空值。
 * 单个测试可通过 `mock.getPaper.mockReturnValueOnce(...)` 覆盖。
 */
export function createMockDB() {
  return {
    // ── 论文 ──
    addPaper: vi.fn(),
    updatePaper: vi.fn().mockReturnValue(1),
    getPaper: vi.fn().mockReturnValue(null),
    queryPapers: vi.fn().mockReturnValue({ items: [], totalCount: 0, offset: 0, limit: 50 }),
    deletePaper: vi.fn().mockReturnValue(1),

    // ── 引用 ──
    addCitation: vi.fn(),
    addCitations: vi.fn(),
    getCitationsFrom: vi.fn().mockReturnValue([]),
    getCitationsTo: vi.fn().mockReturnValue([]),
    deleteCitation: vi.fn().mockReturnValue(1),

    // ── 概念 ──
    addConcept: vi.fn(),
    updateConcept: vi.fn().mockReturnValue({ affectedMappings: 0 }),
    deprecateConcept: vi.fn().mockReturnValue({ affectedMappings: 0 }),
    syncConcepts: vi.fn().mockReturnValue({ added: 0, updated: 0, deprecated: 0 }),
    mergeConcepts: vi.fn().mockReturnValue({ migratedMappings: 0, resolvedConflicts: 0 }),
    splitConcept: vi.fn().mockReturnValue({ conceptA: null, conceptB: null }),
    gcConceptChange: vi.fn().mockReturnValue({ affectedMappings: 0 }),
    getConcept: vi.fn().mockReturnValue(null),
    getAllConcepts: vi.fn().mockReturnValue([]),

    // ── 映射 ──
    mapPaperConcept: vi.fn(),
    updateMapping: vi.fn().mockReturnValue(1),
    getMappingsByPaper: vi.fn().mockReturnValue([]),
    getMappingsByConcept: vi.fn().mockReturnValue([]),
    getMapping: vi.fn().mockReturnValue(null),
    deleteMapping: vi.fn().mockReturnValue(1),
    getConceptMatrix: vi.fn().mockReturnValue([]),

    // ── 标注 ──
    addAnnotation: vi.fn().mockReturnValue(1),
    getAnnotations: vi.fn().mockReturnValue([]),
    getAnnotation: vi.fn().mockReturnValue(null),
    deleteAnnotation: vi.fn().mockReturnValue(1),
    getAnnotationsByConcept: vi.fn().mockReturnValue([]),

    // ── 种子 ──
    addSeed: vi.fn(),
    getSeeds: vi.fn().mockReturnValue([]),
    removeSeed: vi.fn().mockReturnValue(1),

    // ── 检索日志 ──
    addSearchLog: vi.fn().mockReturnValue(1),
    getSearchLog: vi.fn().mockReturnValue([]),

    // ── 文本块 ──
    insertChunkTextOnly: vi.fn().mockReturnValue(1),
    insertChunksTextOnlyBatch: vi.fn().mockReturnValue([]),
    insertChunkVectors: vi.fn(),
    insertChunk: vi.fn().mockReturnValue(1),
    insertChunksBatch: vi.fn().mockReturnValue([]),
    deleteChunksByPaper: vi.fn().mockReturnValue(0),
    deleteChunksByPrefix: vi.fn().mockReturnValue(0),
    getChunksByPaper: vi.fn().mockReturnValue([]),
    getChunkByChunkId: vi.fn().mockReturnValue(null),

    // ── Memo ──
    addMemo: vi.fn().mockReturnValue({ memoId: 'mock-memo-1', chunkRowid: 1 }),
    markMemoIndexed: vi.fn(),
    updateMemo: vi.fn().mockReturnValue(1),
    getMemosByEntity: vi.fn().mockReturnValue([]),
    getMemo: vi.fn().mockReturnValue(null),
    deleteMemo: vi.fn().mockReturnValue(1),

    // ── 笔记 ──
    createNote: vi.fn(),
    onNoteFileChanged: vi.fn(),
    linkMemoToNote: vi.fn(),
    linkNoteToConcept: vi.fn(),
    getNote: vi.fn().mockReturnValue(null),
    getNoteByFilePath: vi.fn().mockReturnValue(null),
    getAllNotes: vi.fn().mockReturnValue([]),
    deleteNote: vi.fn().mockReturnValue(1),

    // ── 概念建议 ──
    addSuggestedConcept: vi.fn().mockReturnValue(1),
    adoptSuggestedConcept: vi.fn(),
    dismissSuggestedConcept: vi.fn().mockReturnValue(1),
    getSuggestedConcepts: vi.fn().mockReturnValue([]),
    getSuggestedConcept: vi.fn().mockReturnValue(null),

    // ── 文章 ──
    createArticle: vi.fn(),
    getArticle: vi.fn().mockReturnValue(null),
    updateArticle: vi.fn().mockReturnValue(1),
    getAllArticles: vi.fn().mockReturnValue([]),
    deleteArticle: vi.fn().mockReturnValue(1),
    setOutline: vi.fn(),
    getOutline: vi.fn().mockReturnValue([]),
    addSectionDraft: vi.fn().mockReturnValue(1),
    getSectionDrafts: vi.fn().mockReturnValue([]),
    markEditedParagraphs: vi.fn().mockReturnValue(1),

    // ── 关系 ──
    computeRelationsForPaper: vi.fn(),
    recomputeAllRelations: vi.fn().mockReturnValue(0),
    getRelationGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
    getRelationsForPaper: vi.fn().mockReturnValue([]),

    // ── 统计 ──
    getStats: vi.fn().mockReturnValue({
      papers: { total: 0 },
      concepts: { total: 0 },
      chunks: { total: 0 },
      mappings: { total: 0, reviewed: 0 },
    }),
    checkIntegrity: vi.fn().mockReturnValue({ ok: true, errors: [] }),

    // ── 文件路径 ──
    getPaperFilePaths: vi.fn().mockReturnValue([]),
    getPaperFigureDir: vi.fn().mockReturnValue(''),

    // ── 快照 ──
    createSnapshot: vi.fn().mockResolvedValue({ snapshotPath: '', meta: {} }),
    listSnapshots: vi.fn().mockReturnValue([]),
    cleanupSnapshots: vi.fn().mockReturnValue(0),

    // ── 热迁移 / WAL ──
    runHotMigration: vi.fn(),
    walCheckpoint: vi.fn(),
  };
}
