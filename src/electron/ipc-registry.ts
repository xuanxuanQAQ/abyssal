/**
 * 声明式 IPC 通道注册表
 *
 * 将 IPC 通道名映射到主进程处理函数。
 * 应用启动时遍历注册表批量调用 ipcMain.handle()。
 *
 * 改进：
 * - ServiceContainer 聚合全部核心服务
 * - requireDb() 统一空检查
 * - 已接入的 handler 直接调用后端 Service 方法
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared-types/ipc';
import type { DatabaseService } from '../core/database';
import type { BibliographyService } from '../core/bibliography';
import type { SearchService } from '../core/search';
import type { AcquireService } from '../core/acquire';
import type { ProcessService } from '../core/process';
import type { RagService } from '../core/rag';
import type { Logger } from '../core/infra/logger';
import type { PaperMetadata } from '../core/types/paper';
import type { ConceptDefinition } from '../core/types/concept';
import type { PdfRect } from '../core/types/annotation';
import { asPaperId, asConceptId, asMemoId, asNoteId, asAnnotationId, asSuggestionId } from '../core/types/common';
import type { UpdateConceptFields, ConflictResolution } from '../core/database/dao/concepts';
import type { MemoEntityType } from '../core/database/dao/memos';
import type { RelationGraphFilter } from '../core/database/dao/relations';

// ─── ServiceContainer ───

export interface ServiceContainer {
  db: DatabaseService | null;
  biblio: BibliographyService | null;
  search: SearchService | null;
  acquire: AcquireService | null;
  process: ProcessService | null;
  rag: RagService | null;
  logger: Logger;
}

// ─── 辅助 ───

function requireDb(services: ServiceContainer): DatabaseService {
  if (!services.db) throw new Error('Database not initialized');
  return services.db;
}

/** 将后端 PaperMetadata 转换为前端 Paper 结构 */
function paperToFrontend(p: PaperMetadata): Record<string, unknown> {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors.map((a) => {
      const parts = a.split(',').map(s => s.trim());
      return { name: a, family: parts[0] ?? a, given: parts[1] ?? '' };
    }),
    year: p.year,
    abstract: p.abstract,
    doi: p.doi,
    paperType: p.paperType,
    relevance: 'medium',
    fulltextStatus: (p as unknown as Record<string, unknown>)['fulltextStatus'] ?? 'not_attempted',
    analysisStatus: (p as unknown as Record<string, unknown>)['analysisStatus'] ?? 'not_started',
    decisionNote: null,
    tags: [],
    dateAdded: (p as unknown as Record<string, unknown>)['createdAt'] as string ?? new Date().toISOString(),
    analysisReport: null,
  };
}

/** 将后端 ConceptDefinition 转换为前端 Concept 结构 */
function conceptToFrontend(c: ConceptDefinition): Record<string, unknown> {
  return {
    id: c.id,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    layer: c.layer,
    definition: c.definition,
    searchKeywords: c.searchKeywords,
    maturity: c.maturity,
    parentId: c.parentId,
    deprecated: c.deprecated,
    createdAt: c.createdAt,
    updatedAt: (c as unknown as Record<string, unknown>)['updatedAt'] ?? null,
  };
}

type HandlerFn = (...args: unknown[]) => unknown | Promise<unknown>;

interface ChannelRegistration {
  channel: string;
  handler: HandlerFn;
}

// ═══ 注册表构建 ═══

function buildRegistry(svc: ServiceContainer): ChannelRegistration[] {
  return [
    // ── db:papers ──
    {
      channel: IPC_CHANNELS.DB_PAPERS_LIST,
      handler: async (_event: unknown, filter?: unknown) => {
        const db = requireDb(svc);
        const result = db.queryPapers((filter as Record<string, unknown>) ?? {});
        return result.items.map(paperToFrontend);
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_GET,
      handler: async (_event: unknown, id: unknown) => {
        const db = requireDb(svc);
        const paper = db.getPaper(asPaperId(id as string));
        if (!paper) throw new Error(`Paper not found: ${id}`);
        return paperToFrontend(paper);
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_UPDATE,
      handler: async (_event: unknown, id: unknown, patch: unknown) => {
        const db = requireDb(svc);
        db.updatePaper(asPaperId(id as string), patch as Partial<PaperMetadata>);
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_BATCH_UPDATE_RELEVANCE,
      handler: async () => { /* TODO: papers 表暂无 relevance 列 */ },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_IMPORT_BIBTEX,
      handler: async (_event: unknown, content: unknown) => {
        const db = requireDb(svc);
        if (!svc.biblio) throw new Error('Bibliography service not initialized');
        const entries = svc.biblio.importBibtex(content as string);
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const entry of entries) {
          try {
            db.addPaper(entry.metadata as PaperMetadata);
            imported++;
          } catch (err) {
            const msg = (err as Error).message;
            if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
              skipped++;
            } else {
              errors.push(`${entry.originalKey}: ${msg}`);
            }
          }
        }
        svc.logger.info('BibTeX import complete', { imported, skipped, errors: errors.length });
        return { imported, skipped, errors };
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_COUNTS,
      handler: async () => {
        const db = requireDb(svc);
        const stats = db.getStats();
        return {
          total: stats.papers.total,
          byRelevance: { seed: 0, high: 0, medium: stats.papers.total, low: 0, excluded: 0 },
          byAnalysisStatus: { not_started: stats.papers.total, in_progress: 0, completed: 0, needs_review: 0, failed: 0 },
          byFulltextStatus: { available: 0, pending: 0, failed: 0, not_attempted: stats.papers.total },
        };
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_DELETE,
      handler: async (_event: unknown, id: unknown) => {
        const db = requireDb(svc);
        db.deletePaper(asPaperId(id as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_PAPERS_BATCH_DELETE,
      handler: async (_event: unknown, ids: unknown) => {
        const db = requireDb(svc);
        for (const id of ids as string[]) {
          try { db.deletePaper(asPaperId(id)); } catch { /* ignore */ }
        }
      },
    },

    // ── db:tags (暂无后端表) ──
    { channel: IPC_CHANNELS.DB_TAGS_LIST, handler: async () => [] },
    { channel: IPC_CHANNELS.DB_TAGS_CREATE, handler: async (_e: unknown, name: unknown) => ({ id: crypto.randomUUID(), name, parentId: null, paperCount: 0, color: null }) },
    { channel: IPC_CHANNELS.DB_TAGS_UPDATE, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_TAGS_DELETE, handler: async () => {} },

    // ── db:discoverRuns ──
    { channel: IPC_CHANNELS.DB_DISCOVER_RUNS_LIST, handler: async () => [] },

    // ── db:concepts（已接入） ──
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_LIST,
      handler: async () => {
        const db = requireDb(svc);
        return db.getAllConcepts().map(conceptToFrontend);
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_GET_FRAMEWORK,
      handler: async () => {
        const db = requireDb(svc);
        const all = db.getAllConcepts();
        const rootIds = all.filter(c => !c.parentId).map(c => c.id);
        return { concepts: all.map(conceptToFrontend), rootIds };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_UPDATE_FRAMEWORK,
      handler: async (_event: unknown, fw: unknown) => {
        const db = requireDb(svc);
        const concepts = (fw as { concepts: ConceptDefinition[] }).concepts;
        const result = db.syncConcepts(concepts, 'merge');
        return { affected: result.affectedMappingCount };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_CREATE,
      handler: async (_event: unknown, draft: unknown) => {
        const db = requireDb(svc);
        const d = draft as ConceptDefinition;
        db.addConcept(d);
        const created = db.getConcept(d.id);
        return created ? conceptToFrontend(created) : null;
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_UPDATE_DEFINITION,
      handler: async (_event: unknown, conceptId: unknown, newDefinition: unknown) => {
        const db = requireDb(svc);
        const result = db.updateConcept(
          asConceptId(conceptId as string),
          { definition: newDefinition as string } as UpdateConceptFields,
        );
        return { updated: true, semanticDrift: result.requiresSynthesizeRefresh };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_UPDATE_MATURITY,
      handler: async (_event: unknown, conceptId: unknown, maturity: unknown) => {
        const db = requireDb(svc);
        db.updateConcept(
          asConceptId(conceptId as string),
          { maturity: maturity as 'tentative' | 'working' | 'established' } as UpdateConceptFields,
        );
        return { historyEntry: { conceptId, action: 'maturity_change', timestamp: new Date().toISOString() } };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_UPDATE_PARENT,
      handler: async (_event: unknown, conceptId: unknown, newParentId: unknown) => {
        const db = requireDb(svc);
        db.updateConcept(
          asConceptId(conceptId as string),
          { parentId: (newParentId as string | null) ? asConceptId(newParentId as string) : null } as UpdateConceptFields,
        );
        return { updated: true, cycleDetected: false };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_GET_HISTORY,
      handler: async (_event: unknown, conceptId: unknown) => {
        const db = requireDb(svc);
        const concept = db.getConcept(asConceptId(conceptId as string));
        return concept?.history ?? [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_MERGE,
      handler: async (_event: unknown, retainId: unknown, mergeId: unknown) => {
        const db = requireDb(svc);
        const result = db.mergeConcepts(
          asConceptId(retainId as string),
          asConceptId(mergeId as string),
          'max_confidence' as ConflictResolution,
        );
        return { conflicts: result.conflicts, migratedMappings: result.migratedMappings };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_SPLIT,
      handler: async (_event: unknown, originalId: unknown, newA: unknown, newB: unknown) => {
        const db = requireDb(svc);
        const result = db.splitConcept(
          asConceptId(originalId as string),
          newA as ConceptDefinition,
          newB as ConceptDefinition,
        );
        return { conceptA: result.conceptA, conceptB: result.conceptB, pendingMappings: result.pendingMappings };
      },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_RESOLVE_MERGE,
      handler: async () => { /* 已在 merge 中一步完成 */ },
    },
    {
      channel: IPC_CHANNELS.DB_CONCEPTS_REASSIGN,
      handler: async () => { /* TODO: 映射重分配 */ },
    },
    {
      channel: 'db:concepts:search',
      handler: async (_event: unknown, query: unknown) => {
        const db = requireDb(svc);
        const all = db.getAllConcepts();
        const q = (query as string).toLowerCase();
        return all
          .filter(c => c.nameEn.toLowerCase().includes(q) || c.nameZh.includes(q) || c.definition.toLowerCase().includes(q))
          .map(conceptToFrontend);
      },
    },

    // ── db:mappings（已接入） ──
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_FOR_PAPER,
      handler: async (_event: unknown, paperId: unknown) => {
        const db = requireDb(svc);
        return db.getMappingsByPaper(asPaperId(paperId as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_FOR_CONCEPT,
      handler: async (_event: unknown, conceptId: unknown) => {
        const db = requireDb(svc);
        return db.getMappingsByConcept(asConceptId(conceptId as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_ADJUDICATE,
      handler: async () => { /* TODO: 需要 adjudicateMapping DAO */ },
    },
    {
      channel: IPC_CHANNELS.DB_MAPPINGS_GET_HEATMAP_DATA,
      handler: async () => {
        const db = requireDb(svc);
        const entries = db.getConceptMatrix();
        // 转换 ConceptMatrixEntry[] → HeatmapMatrix { conceptIds, paperIds, cells }
        const conceptIds = [...new Set(entries.map(e => e.conceptId))];
        const paperIds = [...new Set(entries.map(e => e.paperId))];
        const cells = entries.map(e => ({
          paperId: e.paperId,
          conceptId: e.conceptId,
          relation: e.relation,
          confidence: e.confidence,
          reviewed: e.reviewed,
        }));
        return { conceptIds, paperIds, cells };
      },
    },

    // ── db:annotations（已接入） ──
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_LIST_FOR_PAPER,
      handler: async (_event: unknown, paperId: unknown) => {
        const db = requireDb(svc);
        return db.getAnnotations(asPaperId(paperId as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_CREATE,
      handler: async (_event: unknown, annotation: unknown) => {
        const db = requireDb(svc);
        const a = annotation as Record<string, unknown>;
        const rect = a['rect'] as Record<string, number> | undefined;
        return db.addAnnotation({
          paperId: asPaperId(a['paperId'] as string),
          type: a['type'] as 'highlight' | 'note' | 'concept_tag',
          page: ((a['pageNumber'] ?? a['page']) as number) || 0,
          rect: rect ? { x0: rect['x0'] ?? rect['x'] ?? 0, y0: rect['y0'] ?? rect['y'] ?? 0, x1: rect['x1'] ?? (rect['x'] ?? 0) + (rect['width'] ?? 0), y1: rect['y1'] ?? (rect['y'] ?? 0) + (rect['height'] ?? 0) } as PdfRect : { x0: 0, y0: 0, x1: 0, y1: 0 },
          selectedText: (a['selectedText'] as string) ?? '',
          color: (a['color'] as string) ?? '#FFEB3B',
          comment: (a['comment'] as string ?? a['content'] as string) ?? null,
          conceptId: a['conceptId'] ? asConceptId(a['conceptId'] as string) : null,
          createdAt: new Date().toISOString(),
        });
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_UPDATE,
      handler: async () => {
        // TODO: DatabaseService 暂无 updateAnnotation 方法
      },
    },
    {
      channel: IPC_CHANNELS.DB_ANNOTATIONS_DELETE,
      handler: async (_event: unknown, id: unknown) => {
        const db = requireDb(svc);
        db.deleteAnnotation(asAnnotationId(Number(id)));
      },
    },

    // ── db:articles (保持 stub，需要 articles DAO 扩展) ──
    { channel: IPC_CHANNELS.DB_ARTICLES_LIST_OUTLINES, handler: async () => [] },
    { channel: IPC_CHANNELS.DB_ARTICLES_CREATE, handler: async (_e: unknown, title: unknown) => ({ id: crypto.randomUUID(), title, citationStyle: 'GB/T 7714', exportFormat: 'markdown', metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sections: [] }) },
    { channel: IPC_CHANNELS.DB_ARTICLES_UPDATE, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_ARTICLES_GET_OUTLINE, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.DB_ARTICLES_UPDATE_OUTLINE_ORDER, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_ARTICLES_GET_SECTION, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.DB_ARTICLES_UPDATE_SECTION, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_ARTICLES_GET_SECTION_VERSIONS, handler: async () => [] },
    { channel: IPC_CHANNELS.DB_SECTIONS_CREATE, handler: async (_e: unknown, _aId: unknown, _pId: unknown, _sIdx: unknown, title?: unknown) => ({ id: crypto.randomUUID(), title: (title as string) ?? '新节', parentId: _pId, sortIndex: _sIdx, status: 'pending', wordCount: 0, writingInstructions: null, aiModel: null, children: [] }) },
    { channel: IPC_CHANNELS.DB_SECTIONS_DELETE, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_ARTICLES_SEARCH, handler: async () => [] },

    // ── db:relations（已接入） ──
    {
      channel: IPC_CHANNELS.DB_RELATIONS_GET_GRAPH,
      handler: async (_event: unknown, filter?: unknown) => {
        const db = requireDb(svc);
        const f = (filter as Record<string, unknown>) ?? {};
        return db.getRelationGraph({
          centerId: f['focusNodeId'] ? asPaperId(f['focusNodeId'] as string) : undefined,
          depth: (f['hopDepth'] as number) ?? 2,
        } as RelationGraphFilter);
      },
    },
    {
      channel: IPC_CHANNELS.DB_RELATIONS_GET_NEIGHBORHOOD,
      handler: async (_event: unknown, nodeId: unknown, depth: unknown) => {
        const db = requireDb(svc);
        return db.getRelationGraph({
          centerId: asPaperId(nodeId as string),
          depth: (depth as number) ?? 2,
        } as RelationGraphFilter);
      },
    },

    // ── db:memos（已接入） ──
    {
      channel: IPC_CHANNELS.DB_MEMOS_LIST,
      handler: async (_event: unknown, filter?: unknown) => {
        const db = requireDb(svc);
        const f = (filter as Record<string, unknown>) ?? {};
        if (f['entityType'] && f['entityId']) {
          return db.getMemosByEntity(f['entityType'] as MemoEntityType, f['entityId'] as string);
        }
        // 无 filter 时返回空列表（全量 memo 查询需要明确 entityType）
        return [];
      },
    },
    {
      channel: IPC_CHANNELS.DB_MEMOS_GET,
      handler: async (_event: unknown, memoId: unknown) => {
        const db = requireDb(svc);
        const memo = db.getMemo(asMemoId(memoId as string));
        if (!memo) throw new Error(`Memo not found: ${memoId}`);
        return memo;
      },
    },
    {
      channel: IPC_CHANNELS.DB_MEMOS_CREATE,
      handler: async (_event: unknown, memo: unknown) => {
        const db = requireDb(svc);
        const m = memo as Record<string, unknown>;
        return db.addMemo({
          text: (m['text'] as string) ?? (m['content'] as string) ?? '',
          paperIds: (m['paperIds'] as string[]) ?? [],
          conceptIds: (m['conceptIds'] as string[]) ?? [],
          annotationId: null,
          outlineId: null,
          linkedNoteIds: [],
          tags: (m['tags'] as string[]) ?? [],
          indexed: false,
        } as any, null);
      },
    },
    {
      channel: IPC_CHANNELS.DB_MEMOS_UPDATE,
      handler: async (_event: unknown, memoId: unknown, patch: unknown) => {
        const db = requireDb(svc);
        db.updateMemo(asMemoId(memoId as string), patch as Record<string, unknown>);
        return db.getMemo(asMemoId(memoId as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_MEMOS_DELETE,
      handler: async (_event: unknown, memoId: unknown) => {
        const db = requireDb(svc);
        db.deleteMemo(asMemoId(memoId as string));
      },
    },
    { channel: IPC_CHANNELS.DB_MEMOS_UPGRADE_TO_NOTE, handler: async () => ({ noteId: crypto.randomUUID(), filePath: '' }) },
    { channel: IPC_CHANNELS.DB_MEMOS_UPGRADE_TO_CONCEPT, handler: async () => { throw new Error('Not implemented'); } },

    // ── db:notes（已接入） ──
    {
      channel: IPC_CHANNELS.DB_NOTES_LIST,
      handler: async () => {
        const db = requireDb(svc);
        return db.getAllNotes();
      },
    },
    {
      channel: IPC_CHANNELS.DB_NOTES_GET,
      handler: async (_event: unknown, noteId: unknown) => {
        const db = requireDb(svc);
        const note = db.getNote(asNoteId(noteId as string));
        if (!note) throw new Error(`Note not found: ${noteId}`);
        return note;
      },
    },
    {
      channel: IPC_CHANNELS.DB_NOTES_CREATE,
      handler: async (_event: unknown, note: unknown) => {
        const db = requireDb(svc);
        const n = note as Record<string, unknown>;
        const noteId = asNoteId(crypto.randomUUID());
        const filePath = (n['filePath'] as string) ?? `notes/${noteId}.md`;
        db.createNote(
          {
            id: noteId,
            title: (n['title'] as string) ?? '',
            filePath,
            linkedPaperIds: (n['linkedPaperIds'] as string[]) ?? [],
            linkedConceptIds: (n['linkedConceptIds'] as string[]) ?? [],
          } as any,
          [], // chunks（IPC 创建不含内容，后续编辑时再处理）
          [], // embeddings
        );
        return { noteId, filePath };
      },
    },
    {
      channel: IPC_CHANNELS.DB_NOTES_UPDATE_META,
      handler: async (_event: unknown, noteId: unknown, _patch: unknown) => {
        // TODO: DatabaseService 暂无 updateNoteMeta 方法
        const db = requireDb(svc);
        return db.getNote(asNoteId(noteId as string));
      },
    },
    {
      channel: IPC_CHANNELS.DB_NOTES_DELETE,
      handler: async (_event: unknown, noteId: unknown) => {
        const db = requireDb(svc);
        db.deleteNote(asNoteId(noteId as string));
      },
    },
    { channel: IPC_CHANNELS.DB_NOTES_UPGRADE_TO_CONCEPT, handler: async () => { throw new Error('Not implemented'); } },

    // ── fs:notes ──
    { channel: IPC_CHANNELS.FS_READ_NOTE_FILE, handler: async () => '' },
    { channel: IPC_CHANNELS.FS_SAVE_NOTE_FILE, handler: async () => ({ savedAt: new Date().toISOString() }) },

    // ── db:suggestedConcepts（已接入） ──
    {
      channel: IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_LIST,
      handler: async () => {
        const db = requireDb(svc);
        return db.getSuggestedConcepts();
      },
    },
    {
      channel: IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_ACCEPT,
      handler: async (_event: unknown, suggestedId: unknown, draft: unknown) => {
        const db = requireDb(svc);
        const overrides = draft ? (draft as Partial<ConceptDefinition>) : undefined;
        const conceptId = db.adoptSuggestedConcept(asSuggestionId(Number(suggestedId)), overrides);
        const created = db.getConcept(conceptId);
        return created ? conceptToFrontend(created) : null;
      },
    },
    {
      channel: IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_DISMISS,
      handler: async (_event: unknown, suggestedId: unknown) => {
        const db = requireDb(svc);
        db.dismissSuggestedConcept(asSuggestionId(Number(suggestedId)));
      },
    },
    {
      channel: IPC_CHANNELS.DB_SUGGESTED_CONCEPTS_RESTORE,
      handler: async (_event: unknown, _suggestedId: unknown) => {
        // TODO: DatabaseService 暂无 restoreSuggestedConcept 方法
      },
    },

    // ── rag (部分接入) ──
    { channel: IPC_CHANNELS.RAG_SEARCH, handler: async () => [] },
    { channel: 'rag:searchWithReport', handler: async () => ({ chunks: [], qualityReport: { coverage: 'sufficient', retryCount: 0, gaps: [] } }) },
    { channel: IPC_CHANNELS.RAG_GET_WRITING_CONTEXT, handler: async () => ({ relatedSyntheses: [], ragPassages: [], privateKBMatches: [], precedingSummary: '', followingSectionTitles: [] }) },

    // ── pipeline (stub) ──
    { channel: IPC_CHANNELS.PIPELINE_START, handler: async () => crypto.randomUUID() },
    { channel: IPC_CHANNELS.PIPELINE_CANCEL, handler: async () => {} },

    // ── chat (stub) ──
    { channel: IPC_CHANNELS.CHAT_SEND, handler: async () => crypto.randomUUID() },
    { channel: IPC_CHANNELS.DB_CHAT_SAVE_MESSAGE, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_CHAT_GET_HISTORY, handler: async () => [] },
    { channel: IPC_CHANNELS.DB_CHAT_DELETE_SESSION, handler: async () => {} },
    { channel: IPC_CHANNELS.DB_CHAT_LIST_SESSIONS, handler: async () => [] },

    // ── fs ──
    { channel: IPC_CHANNELS.FS_OPEN_PDF, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.FS_SAVE_PDF_ANNOTATIONS, handler: async () => {} },
    { channel: IPC_CHANNELS.FS_EXPORT_ARTICLE, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.FS_IMPORT_FILES, handler: async () => ({ imported: 0, skipped: 0, errors: [] }) },
    { channel: IPC_CHANNELS.FS_CREATE_SNAPSHOT, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.FS_RESTORE_SNAPSHOT, handler: async () => {} },
    { channel: IPC_CHANNELS.FS_LIST_SNAPSHOTS, handler: async () => [] },
    { channel: IPC_CHANNELS.FS_CLEANUP_SNAPSHOTS, handler: async () => {} },

    // ── advisory (stub) ──
    { channel: IPC_CHANNELS.ADVISORY_GET_RECOMMENDATIONS, handler: async () => [] },
    { channel: IPC_CHANNELS.ADVISORY_EXECUTE, handler: async () => crypto.randomUUID() },
    { channel: IPC_CHANNELS.ADVISORY_GET_NOTIFICATIONS, handler: async () => [] },

    // ── app ──
    {
      channel: IPC_CHANNELS.APP_GET_CONFIG,
      handler: async () => ({
        language: 'zh',
        llmProvider: 'claude',
        llmModel: 'claude-sonnet-4-20250514',
        workspacePath: 'workspace',
      }),
    },
    { channel: IPC_CHANNELS.APP_UPDATE_CONFIG, handler: async () => {} },
    {
      channel: IPC_CHANNELS.APP_GET_PROJECT_INFO,
      handler: async () => {
        try {
          const db = requireDb(svc);
          const stats = db.getStats();
          return {
            name: 'Abyssal Project',
            paperCount: stats.papers.total,
            conceptCount: stats.concepts.total,
            lastModified: new Date().toISOString(),
          };
        } catch {
          return { name: 'Abyssal Project', paperCount: 0, conceptCount: 0, lastModified: new Date().toISOString() };
        }
      },
    },
    { channel: IPC_CHANNELS.APP_SWITCH_PROJECT, handler: async () => { throw new Error('Not implemented'); } },
    { channel: IPC_CHANNELS.APP_LIST_PROJECTS, handler: async () => [] },
    { channel: IPC_CHANNELS.APP_CREATE_PROJECT, handler: async () => ({ name: 'New Project', paperCount: 0, conceptCount: 0, lastModified: new Date().toISOString() }) },

    // ── app:globalSearch（已接入 FTS5） ──
    {
      channel: IPC_CHANNELS.APP_GLOBAL_SEARCH,
      handler: async (_event: unknown, query: unknown) => {
        try {
          const db = requireDb(svc);
          const q = (query as string ?? '').trim();
          if (!q) return [];
          // 搜索论文标题
          const papers = db.queryPapers({ searchText: q, limit: 10 });
          return papers.items.map(p => ({
            type: 'paper' as const,
            id: p.id,
            title: p.title,
            snippet: p.abstract?.slice(0, 200) ?? '',
          }));
        } catch {
          return [];
        }
      },
    },

    // ── app:window ──
    { channel: IPC_CHANNELS.APP_WINDOW_POP_OUT, handler: async () => { throw new Error('多窗口功能暂不支持'); } },
    { channel: IPC_CHANNELS.APP_WINDOW_LIST, handler: async () => [] },
  ];
}

/** 注册 renderer→main 单向事件监听器 */
function registerEventListeners(): void {
  ipcMain.on(
    IPC_CHANNELS.READER_PAGE_CHANGED,
    (_event: Electron.IpcMainEvent, _paperId: unknown, _page: unknown) => {
      // TODO: 接入分析引擎查询当前页相关概念映射证据
    }
  );
}

/**
 * 批量注册所有 IPC handler
 * 在 app.whenReady() 后调用一次
 */
export function registerAllIPCHandlers(services: ServiceContainer): void {
  const registry = buildRegistry(services);
  for (const { channel, handler } of registry) {
    ipcMain.handle(channel, handler);
  }
  registerEventListeners();
  console.log(`[IPC] Registered ${registry.length} handlers + event listeners`);
}
