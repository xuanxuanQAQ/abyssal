/**
 * Tool Registry — tool definitions for Agent Loop.
 *
 * Three permission levels:
 *   Level 0 (read-only): Always allowed, no confirmation needed
 *   Level 1 (low-risk write): Auto-approved, logged to audit
 *   Level 2 (high-risk write): Requires user confirmation via IPC
 *
 * See spec: §6
 */

import type { ToolDefinition } from '../llm-client/llm-client';

// ─── Types ───

export type ToolPermissionLevel = 0 | 1 | 2;
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  permissionLevel: ToolPermissionLevel;
}

/** Callback for Level 2 write tools — asks user for confirmation. */
export type ConfirmationCallback = (toolName: string, description: string, args: Record<string, unknown>) => Promise<boolean>;

// ─── Read-only tool allowlist (§6.2 — Default Deny / Allowlist) ───
//
// Security model: ONLY tools in this allowlist can be registered and executed.
// Any tool not in this set is rejected at both registration and runtime.
// This follows the "default deny" principle — new tools must be explicitly
// approved here before the Agent can use them.

const ALLOWED_TOOLS = new Set([
  // Level 0: Read-only
  'get_paper',
  'query_papers',
  'get_concept',
  'get_concept_history',
  'get_concept_matrix',
  'get_annotations',
  'get_relation_graph',
  'get_stats',
  'query_memos',
  'query_notes',
  'get_note',
  'get_concept_suggestions',
  'search_papers',
  'search_knowledge',
  'retrieve',
  'web_search',
  // Level 1: Low-risk writes (auto-approved)
  'add_memo',
  'add_annotation',
  'create_note',
  'update_note',
  'acquire_fulltext',
  'import_paper',
  // Level 2: High-risk writes (require confirmation)
  'adopt_suggestion',
  'dismiss_suggestion',
  'adjudicate_mapping',
  'delete_note',
]);

// ─── Services interface (subset of AppContext) ───

export interface ToolServices {
  dbProxy: {
    getPaper: (id: unknown) => Promise<unknown>;
    queryPapers: (filter: unknown) => Promise<unknown>;
    getAllConcepts: () => Promise<unknown>;
    getConcept: (id: unknown) => Promise<unknown>;
    getAnnotations: (paperId: unknown) => Promise<unknown>;
    getRelationGraph: (filter: unknown) => Promise<unknown>;
    getConceptMatrix: () => Promise<unknown>;
    getStats: () => Promise<unknown>;
    getMemosByEntity: (entityType: unknown, entityId: unknown) => Promise<unknown>;
    getAllNotes: () => Promise<unknown>;
    getSuggestedConcepts: () => Promise<unknown>;
    // Note methods
    getNote: (id: unknown) => Promise<unknown>;
    queryNotes: (filter?: unknown) => Promise<unknown>;
    createNote: (note: unknown, chunks: unknown[], embeddings: unknown[]) => Promise<unknown>;
    updateNoteMeta: (id: unknown, updates: unknown) => Promise<unknown>;
    deleteNote: (id: unknown) => Promise<unknown>;
    // Write methods (Level 1-2)
    addMemo?: (memo: unknown, embedding: unknown) => Promise<unknown>;
    addAnnotation?: (annotation: unknown) => Promise<unknown>;
    adoptSuggestedConcept?: (suggestionId: unknown, overrides?: unknown) => Promise<unknown>;
    dismissSuggestedConcept?: (suggestionId: unknown) => Promise<unknown>;
    adjudicateMapping?: (paperId: unknown, conceptId: unknown, decision: unknown, revisions?: unknown) => Promise<unknown>;
  };
  searchService?: {
    searchSemanticScholar: (query: string, options?: { limit?: number }) => Promise<unknown>;
  } | null;
  ragService?: {
    searchSemantic: (query: string, topK?: number) => Promise<unknown>;
    retrieve: (request: Record<string, unknown>) => Promise<unknown>;
  } | null;
  webSearchService?: {
    search: (query: string, options?: { limit?: number }) => Promise<unknown>;
  } | null;
  /** Returns a human-readable reason when webSearchService is null. */
  getWebSearchDisabledReason?: () => string;
  /** Callback for Level 2 write confirmations. If null, Level 2 tools are disabled. */
  confirmWrite?: ConfirmationCallback | null;
  /** Orchestrator for triggering acquire workflow */
  orchestrator?: {
    start: (workflow: string, options: { paperIds: string[]; concurrency?: number }) => { id: string };
  } | null;
  /** Add a paper to the database (used by import_paper tool) */
  addPaper?: (paper: Record<string, unknown>) => Promise<string>;
  /** Update paper status (e.g. mark as pending before acquire) */
  updatePaper?: (id: string, fields: Record<string, unknown>) => Promise<void>;
}

// ─── Truncation helpers (§6.3) ───

function truncateArray(result: unknown, maxItems: number): unknown {
  if (!Array.isArray(result)) return result;
  if (result.length <= maxItems) return result;
  return [...result.slice(0, maxItems), { _truncated: true, _total: result.length, _showing: maxItems }];
}

// ─── Registry ───

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(services: ToolServices) {
    this.registerAll(services);
  }

  private registerAll(svc: ToolServices): void {
    const db = svc.dbProxy;

    // ─── DB query tools (fully implemented) ───

    this.register({
      definition: { name: 'get_paper', description: 'Get paper details by ID', inputSchema: { type: 'object', properties: { paperId: { type: 'string', description: 'Paper ID (12-char hex)' } }, required: ['paperId'] } },
      handler: async (args) => db.getPaper(args['paperId']),
    });

    this.register({
      definition: { name: 'query_papers', description: 'Query papers with filters', inputSchema: { type: 'object', properties: { searchText: { type: 'string', description: 'Full-text search' }, limit: { type: 'number', description: 'Max results (default 20)' }, offset: { type: 'number' } } } },
      handler: async (args) => {
        const result = await db.queryPapers(args);
        return truncateArray(result, 20);
      },
    });

    this.register({
      definition: { name: 'get_concept', description: 'Get concept definition by ID', inputSchema: { type: 'object', properties: { conceptId: { type: 'string' } }, required: ['conceptId'] } },
      handler: async (args) => db.getConcept(args['conceptId']),
    });

    this.register({
      definition: { name: 'get_concept_history', description: 'Get concept evolution history', inputSchema: { type: 'object', properties: { conceptId: { type: 'string' } }, required: ['conceptId'] } },
      handler: async (args) => {
        const c = await db.getConcept(args['conceptId']) as Record<string, unknown> | null;
        return truncateArray(c?.['history'] ?? [], 20);
      },
    });

    this.register({
      definition: { name: 'get_concept_matrix', description: 'Get concept-paper mapping matrix', inputSchema: { type: 'object', properties: {} } },
      handler: async () => truncateArray(await db.getConceptMatrix(), 50),
    });

    this.register({
      definition: { name: 'get_annotations', description: 'Get annotations for a paper', inputSchema: { type: 'object', properties: { paperId: { type: 'string' } }, required: ['paperId'] } },
      handler: async (args) => truncateArray(await db.getAnnotations(args['paperId']), 20),
    });

    this.register({
      definition: { name: 'get_relation_graph', description: 'Get paper relation graph', inputSchema: { type: 'object', properties: { centerId: { type: 'string' }, depth: { type: 'number' }, edgeTypes: { type: 'array', items: { type: 'string' } } } } },
      handler: async (args) => db.getRelationGraph(args),
    });

    this.register({
      definition: { name: 'get_stats', description: 'Get project statistics', inputSchema: { type: 'object', properties: {} } },
      handler: async () => db.getStats(),
    });

    this.register({
      definition: { name: 'query_memos', description: 'Query research memos. Filter by conceptId, paperId, or search text.', inputSchema: { type: 'object', properties: { entityType: { type: 'string', enum: ['paper', 'concept', 'annotation', 'outline'], description: 'Entity type to filter by' }, entityId: { type: 'string', description: 'Entity ID to filter by' } }, required: ['entityType', 'entityId'] } },
      handler: async (args) => truncateArray(await db.getMemosByEntity(args['entityType'], args['entityId']), 20),
    });

    this.register({
      definition: {
        name: 'query_notes',
        description: 'Search and list research notes. Can filter by concept, paper, tag, or text.',
        inputSchema: {
          type: 'object',
          properties: {
            searchText: { type: 'string', description: 'Full-text search in note titles' },
            conceptIds: { type: 'array', items: { type: 'string' }, description: 'Filter by linked concept IDs' },
            paperIds: { type: 'array', items: { type: 'string' }, description: 'Filter by linked paper IDs' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          },
        },
      },
      handler: async (args) => {
        const hasFilter = args['searchText'] || args['conceptIds'] || args['paperIds'] || args['tags'];
        if (hasFilter) {
          return truncateArray(await db.queryNotes(args), 10);
        }
        return truncateArray(await db.getAllNotes(), 10);
      },
    });

    this.register({
      definition: {
        name: 'get_note',
        description: 'Get a specific research note by ID, including its metadata (title, linked papers, linked concepts, tags)',
        inputSchema: {
          type: 'object',
          properties: { noteId: { type: 'string', description: 'Note ID' } },
          required: ['noteId'],
        },
      },
      handler: async (args) => {
        const note = await db.getNote(args['noteId']);
        if (!note) return { error: `Note not found: ${args['noteId']}` };
        return note;
      },
    });

    this.register({
      definition: { name: 'get_concept_suggestions', description: 'List pending AI concept suggestions', inputSchema: { type: 'object', properties: {} } },
      handler: async () => truncateArray(await db.getSuggestedConcepts(), 10),
    });

    // ─── Search/RAG tools (delegate to services when available) ───

    this.register({
      definition: { name: 'search_papers', description: 'Search academic databases (Semantic Scholar) for papers by query', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, limit: { type: 'number', description: 'Max results (default 10, max 20)' }, yearRange: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } }, description: 'Year range filter' } }, required: ['query'] } },
      handler: async (args) => {
        if (!svc.searchService) {
          return { error: 'Search service not configured. Add API keys in settings.' };
        }
        const results = await svc.searchService.searchSemanticScholar(
          args['query'] as string,
          { limit: Math.min((args['limit'] as number) ?? 10, 20) },
        );
        return truncateArray(results, 10);
      },
    });

    this.register({
      definition: { name: 'search_knowledge', description: 'Semantic vector search across indexed paper chunks, memos, and notes', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, topK: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
      handler: async (args) => {
        if (!svc.ragService) {
          return { error: 'RAG service not configured. Embedding model required.' };
        }
        const results = await svc.ragService.searchSemantic(
          args['query'] as string,
          Math.min((args['topK'] as number) ?? 10, 20),
        );
        return truncateArray(results, 10);
      },
    });

    this.register({
      definition: { name: 'retrieve', description: 'Full three-phase RAG pipeline (vector recall + rerank + assembly)', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, conceptIds: { type: 'array', items: { type: 'string' }, description: 'Concept IDs to focus on' }, topK: { type: 'number', description: 'Max chunks (default 10)' } }, required: ['query'] } },
      handler: async (args) => {
        if (!svc.ragService) {
          return { error: 'RAG service not configured. Embedding model required.' };
        }
        const result = await svc.ragService.retrieve({
          queryText: args['query'],
          conceptIds: args['conceptIds'] ?? [],
          topK: Math.min((args['topK'] as number) ?? 10, 20),
          taskType: 'ad_hoc',
        });
        const chunks = (result as Record<string, unknown>)['chunks'];
        return { chunks: truncateArray(chunks, 10) };
      },
    });

    // ─── Web search tool (Level 0, read-only) ───

    this.register({
      definition: {
        name: 'web_search',
        description:
          'Search the web for general information, recent news, or topics not covered by academic databases. ' +
          'Use when the user asks about non-academic topics, needs up-to-date information, or when search_papers returns insufficient results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 5, max 10)' },
          },
          required: ['query'],
        },
      },
      handler: async (args) => {
        if (!svc.webSearchService) {
          const reason = svc.getWebSearchDisabledReason?.() ??
            'Web search not configured. Enable webSearch and add an API key in settings.';
          return { error: reason };
        }
        const results = await svc.webSearchService.search(
          args['query'] as string,
          { limit: Math.min((args['limit'] as number) ?? 5, 10) },
        );
        return truncateArray(results, 10);
      },
    });

    // ─── Level 1 write tools (auto-approved, low risk) ───

    if (svc.dbProxy.addMemo) {
      this.register({
        definition: { name: 'add_memo', description: 'Create a research memo linked to a paper, concept, or annotation', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Memo content' }, entityType: { type: 'string', enum: ['paper', 'concept', 'annotation'] }, entityId: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['text', 'entityType', 'entityId'] } },
        handler: async (args) => {
          const memo = { text: args['text'], entityType: args['entityType'], entityId: args['entityId'], tags: args['tags'] ?? [] };
          return svc.dbProxy.addMemo!(memo, null);
        },
        permissionLevel: 1,
      });
    }

    // ── Note write tools ──

    this.register({
      definition: {
        name: 'create_note',
        description: 'Create a new structured research note. Returns the note ID. The note can be linked to papers and concepts.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            content: { type: 'string', description: 'Initial note content (plain text or markdown)' },
            linkedPaperIds: { type: 'array', items: { type: 'string' }, description: 'Paper IDs to link' },
            linkedConceptIds: { type: 'array', items: { type: 'string' }, description: 'Concept IDs to link' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
          },
          required: ['title'],
        },
      },
      handler: async (args) => {
        const noteId = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const title = args['title'] as string;
        const content = (args['content'] as string) ?? '';
        const linkedPaperIds = (args['linkedPaperIds'] as string[]) ?? [];
        const linkedConceptIds = (args['linkedConceptIds'] as string[]) ?? [];
        const tags = (args['tags'] as string[]) ?? [];
        const filePath = `notes/${noteId}.md`;

        await db.createNote(
          { id: noteId, title, filePath, linkedPaperIds, linkedConceptIds, tags },
          [],  // chunks (empty initially — file save triggers re-index)
          [],  // embeddings
        );

        return { noteId, title, message: `Note "${title}" created. ID: ${noteId}` };
      },
      permissionLevel: 1,
    });

    this.register({
      definition: {
        name: 'update_note',
        description: 'Update a research note\'s metadata (title, tags, linked papers/concepts). Does not modify the note body content.',
        inputSchema: {
          type: 'object',
          properties: {
            noteId: { type: 'string', description: 'Note ID to update' },
            title: { type: 'string', description: 'New title' },
            linkedPaperIds: { type: 'array', items: { type: 'string' }, description: 'New linked paper IDs (replaces existing)' },
            linkedConceptIds: { type: 'array', items: { type: 'string' }, description: 'New linked concept IDs (replaces existing)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'New tags (replaces existing)' },
          },
          required: ['noteId'],
        },
      },
      handler: async (args) => {
        const noteId = args['noteId'] as string;
        const patch: Record<string, unknown> = {};
        if (args['title'] !== undefined) patch['title'] = args['title'];
        if (args['linkedPaperIds'] !== undefined) patch['linkedPaperIds'] = args['linkedPaperIds'];
        if (args['linkedConceptIds'] !== undefined) patch['linkedConceptIds'] = args['linkedConceptIds'];
        if (args['tags'] !== undefined) patch['tags'] = args['tags'];

        if (Object.keys(patch).length === 0) {
          return { error: 'No fields to update. Provide at least one of: title, linkedPaperIds, linkedConceptIds, tags.' };
        }

        const updated = await db.updateNoteMeta(noteId, patch);
        if (!updated) return { error: `Note not found: ${noteId}` };
        return { noteId, message: 'Note updated', updated };
      },
      permissionLevel: 1,
    });

    this.register({
      definition: {
        name: 'delete_note',
        description: 'Delete a research note permanently. This cannot be undone.',
        inputSchema: {
          type: 'object',
          properties: { noteId: { type: 'string', description: 'Note ID to delete' } },
          required: ['noteId'],
        },
      },
      handler: async (args) => {
        const noteId = args['noteId'] as string;
        const note = await db.getNote(noteId);
        if (!note) return { error: `Note not found: ${noteId}` };

        if (svc.confirmWrite) {
          const approved = await svc.confirmWrite('delete_note', `Delete note "${(note as Record<string, unknown>)['title']}"?`, args);
          if (!approved) return { error: 'User declined the deletion' };
        }

        await db.deleteNote(noteId);
        return { message: `Note "${(note as Record<string, unknown>)['title']}" deleted.` };
      },
      permissionLevel: 2,
    });

    if (svc.dbProxy.addAnnotation) {
      this.register({
        definition: { name: 'add_annotation', description: 'Add a highlight/annotation to a paper', inputSchema: { type: 'object', properties: { paperId: { type: 'string' }, text: { type: 'string', description: 'Annotation text' }, page: { type: 'number' }, conceptId: { type: 'string', description: 'Optional linked concept' } }, required: ['paperId', 'text'] } },
        handler: async (args) => svc.dbProxy.addAnnotation!(args),
        permissionLevel: 1,
      });
    }

    // ─── Acquire / Import tools (Level 1, auto-approved) ───

    if (svc.orchestrator) {
      this.register({
        definition: {
          name: 'acquire_fulltext',
          description: 'Trigger fulltext acquisition (download PDF + text extraction + indexing) for a paper already in the library. The paper must exist in the database. Returns workflow task ID.',
          inputSchema: {
            type: 'object',
            properties: {
              paperId: { type: 'string', description: 'Paper ID to acquire fulltext for' },
            },
            required: ['paperId'],
          },
        },
        handler: async (args) => {
          const paperId = args['paperId'] as string;
          // Verify paper exists
          const paper = await db.getPaper(paperId) as Record<string, unknown> | null;
          if (!paper) {
            return { error: `Paper ${paperId} not found in database. Use import_paper to add it first.` };
          }
          const status = (paper['fulltextStatus'] ?? paper['fulltext_status']) as string;
          if (status === 'available') {
            return { status: 'already_available', paperId, message: 'Fulltext is already available for this paper.' };
          }
          // Mark as pending
          if (svc.updatePaper) {
            try { await svc.updatePaper(paperId, { fulltextStatus: 'pending' }); } catch { /* best-effort */ }
          }
          // Start acquire workflow
          const task = svc.orchestrator!.start('acquire', { paperIds: [paperId], concurrency: 1 });
          return { status: 'started', paperId, taskId: task.id, message: 'Fulltext acquisition started. The paper will be downloaded, processed, and indexed.' };
        },
        permissionLevel: 1,
      });
    }

    if (svc.addPaper && svc.orchestrator) {
      this.register({
        definition: {
          name: 'import_paper',
          description: 'Import a paper from external search results into the library and optionally trigger fulltext acquisition. Use this after search_papers finds a paper not yet in the library.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Paper title' },
              authors: { type: 'array', items: { type: 'string' }, description: 'Author names' },
              year: { type: 'number', description: 'Publication year' },
              doi: { type: 'string', description: 'DOI' },
              arxivId: { type: 'string', description: 'arXiv ID' },
              abstract: { type: 'string', description: 'Abstract' },
              venue: { type: 'string', description: 'Journal or conference name' },
              acquire: { type: 'boolean', description: 'Trigger fulltext acquisition immediately (default true)' },
            },
            required: ['title'],
          },
        },
        handler: async (args) => {
          const title = args['title'] as string;
          const doi = (args['doi'] as string) ?? null;

          // Dedup check: search existing papers by DOI or title
          if (doi) {
            const existing = await db.queryPapers({ searchText: doi, limit: 1 }) as { items: Array<Record<string, unknown>> };
            if (existing.items.length > 0) {
              const p = existing.items[0]!;
              return { status: 'already_exists', paperId: p['id'], title: p['title'], message: 'Paper already exists in the library.' };
            }
          }
          const titleSearch = await db.queryPapers({ searchText: title, limit: 3 }) as { items: Array<Record<string, unknown>> };
          for (const p of titleSearch.items) {
            const existingTitle = ((p['title'] as string) ?? '').toLowerCase().trim();
            if (existingTitle === title.toLowerCase().trim()) {
              return { status: 'already_exists', paperId: p['id'], title: p['title'], message: 'Paper already exists in the library.' };
            }
          }

          // Import
          const paper: Record<string, unknown> = {
            title,
            authors: (args['authors'] as string[]) ?? [],
            year: (args['year'] as number) ?? null,
            doi,
            arxivId: (args['arxivId'] as string) ?? null,
            abstract: (args['abstract'] as string) ?? null,
            venue: (args['venue'] as string) ?? null,
            paperType: 'unknown',
            source: 'manual',
          };
          const paperId = await svc.addPaper!(paper);

          // Optionally trigger acquire
          const shouldAcquire = args['acquire'] !== false;
          let taskId: string | null = null;
          if (shouldAcquire && svc.orchestrator) {
            if (svc.updatePaper) {
              try { await svc.updatePaper(paperId, { fulltextStatus: 'pending' }); } catch { /* best-effort */ }
            }
            const task = svc.orchestrator.start('acquire', { paperIds: [paperId], concurrency: 1 });
            taskId = task.id;
          }

          return {
            status: 'imported',
            paperId,
            taskId,
            message: shouldAcquire
              ? `Paper "${title}" imported and fulltext acquisition started.`
              : `Paper "${title}" imported. Use acquire_fulltext to download the fulltext later.`,
          };
        },
        permissionLevel: 1,
      });
    }

    // ─── Level 2 write tools (require user confirmation) ───

    if (svc.dbProxy.adoptSuggestedConcept) {
      this.register({
        definition: { name: 'adopt_suggestion', description: 'Adopt a suggested concept into the framework', inputSchema: { type: 'object', properties: { suggestionId: { type: 'string' } }, required: ['suggestionId'] } },
        handler: async (args) => {
          if (svc.confirmWrite) {
            const approved = await svc.confirmWrite('adopt_suggestion', `Adopt suggested concept ${args['suggestionId']} into the framework?`, args);
            if (!approved) return { error: 'User declined the operation' };
          }
          return svc.dbProxy.adoptSuggestedConcept!(args['suggestionId']);
        },
        permissionLevel: 2,
      });
    }

    if (svc.dbProxy.dismissSuggestedConcept) {
      this.register({
        definition: { name: 'dismiss_suggestion', description: 'Dismiss a suggested concept', inputSchema: { type: 'object', properties: { suggestionId: { type: 'string' } }, required: ['suggestionId'] } },
        handler: async (args) => {
          if (svc.confirmWrite) {
            const approved = await svc.confirmWrite('dismiss_suggestion', `Dismiss suggested concept ${args['suggestionId']}?`, args);
            if (!approved) return { error: 'User declined the operation' };
          }
          return svc.dbProxy.dismissSuggestedConcept!(args['suggestionId']);
        },
        permissionLevel: 2,
      });
    }

    if (svc.dbProxy.adjudicateMapping) {
      this.register({
        definition: { name: 'adjudicate_mapping', description: 'Accept, reject, or revise a paper-concept mapping', inputSchema: { type: 'object', properties: { paperId: { type: 'string' }, conceptId: { type: 'string' }, decision: { type: 'string', enum: ['accepted', 'rejected', 'revised'] }, note: { type: 'string' } }, required: ['paperId', 'conceptId', 'decision'] } },
        handler: async (args) => {
          if (svc.confirmWrite) {
            const approved = await svc.confirmWrite('adjudicate_mapping', `${args['decision']} mapping: paper ${args['paperId']} ↔ concept ${args['conceptId']}`, args);
            if (!approved) return { error: 'User declined the operation' };
          }
          return svc.dbProxy.adjudicateMapping!(args['paperId'], args['conceptId'], args['decision'], { note: args['note'] });
        },
        permissionLevel: 2,
      });
    }
  }

  private register(tool: Omit<RegisteredTool, 'permissionLevel'> & { permissionLevel?: ToolPermissionLevel }): void {
    // Allowlist enforcement: only explicitly approved tools can be registered
    if (!ALLOWED_TOOLS.has(tool.definition.name)) {
      throw new Error(
        `Tool "${tool.definition.name}" is not in the Agent Loop allowlist. ` +
        `Add it to ALLOWED_TOOLS in tool-registry.ts if it is approved.`,
      );
    }
    this.tools.set(tool.definition.name, {
      ...tool,
      permissionLevel: tool.permissionLevel ?? 0,
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Allowlist enforcement at runtime (defense in depth)
    if (!ALLOWED_TOOLS.has(name)) {
      return { error: `Tool "${name}" is not permitted. Only read-only tools are available. Use the application UI to modify data.` };
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Unknown tool "${name}". Available tools: ${Array.from(this.tools.keys()).join(', ')}` };
    }

    try {
      const result = await tool.handler(args);
      // Hard truncation: any output > 50KB
      const serialized = JSON.stringify(result);
      if (serialized.length > 50 * 1024) {
        if (Array.isArray(result)) {
          return truncateArray(result, Math.max(1, Math.floor(result.length / 2)));
        }
        return { _truncated: true, preview: serialized.slice(0, 5000) };
      }
      return result;
    } catch (error) {
      return { error: `Tool execution failed: ${(error as Error).message}` };
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  get toolCount(): number {
    return this.tools.size;
  }
}
