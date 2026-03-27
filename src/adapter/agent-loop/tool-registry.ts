/**
 * Tool Registry — read-only tool definitions for Agent Loop.
 *
 * 16 read-only tools. Write operations are explicitly blacklisted
 * with dual protection: not registered + runtime interception.
 *
 * See spec: §6
 */

import type { ToolDefinition } from '../llm-client/llm-client';

// ─── Types ───

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

// ─── Read-only tool allowlist (§6.2 — Default Deny / Allowlist) ───
//
// Security model: ONLY tools in this allowlist can be registered and executed.
// Any tool not in this set is rejected at both registration and runtime.
// This follows the "default deny" principle — new tools must be explicitly
// approved here before the Agent can use them.

const ALLOWED_TOOLS = new Set([
  'get_paper',
  'query_papers',
  'get_concept',
  'get_concept_history',
  'get_concept_matrix',
  'get_annotations',
  'get_relation_graph',
  'get_stats',
  'query_memos',
  'get_memos_by_entity',
  'query_notes',
  'get_concept_suggestions',
  'get_citation_graph',
  'search_papers',
  'search_knowledge',
  'retrieve',
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
  };
  searchService?: {
    searchSemanticScholar: (query: string, options?: { limit?: number }) => Promise<unknown>;
  } | null;
  ragService?: {
    searchSemantic: (query: string, topK?: number) => Promise<unknown>;
    retrieve: (request: Record<string, unknown>) => Promise<unknown>;
  } | null;
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
      definition: { name: 'get_memos_by_entity', description: 'Get memos linked to a specific entity', inputSchema: { type: 'object', properties: { entityType: { type: 'string', enum: ['paper', 'concept', 'annotation', 'outline'] }, entityId: { type: 'string' } }, required: ['entityType', 'entityId'] } },
      handler: async (args) => truncateArray(await db.getMemosByEntity(args['entityType'], args['entityId']), 30),
    });

    this.register({
      definition: { name: 'query_notes', description: 'List all research notes', inputSchema: { type: 'object', properties: {} } },
      handler: async () => truncateArray(await db.getAllNotes(), 10),
    });

    this.register({
      definition: { name: 'get_concept_suggestions', description: 'List pending AI concept suggestions', inputSchema: { type: 'object', properties: {} } },
      handler: async () => truncateArray(await db.getSuggestedConcepts(), 10),
    });

    this.register({
      definition: { name: 'get_citation_graph', description: 'Get citation network for a paper', inputSchema: { type: 'object', properties: { paperId: { type: 'string' }, depth: { type: 'number', description: 'Traversal depth (default 2)' } }, required: ['paperId'] } },
      handler: async (args) => db.getRelationGraph({ centerId: args['paperId'], depth: (args['depth'] as number) ?? 2 }),
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
  }

  private register(tool: RegisteredTool): void {
    // Allowlist enforcement: only explicitly approved tools can be registered
    if (!ALLOWED_TOOLS.has(tool.definition.name)) {
      throw new Error(
        `Tool "${tool.definition.name}" is not in the Agent Loop allowlist. ` +
        `Add it to ALLOWED_TOOLS in tool-registry.ts if it is a safe read-only operation.`,
      );
    }
    this.tools.set(tool.definition.name, tool);
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
