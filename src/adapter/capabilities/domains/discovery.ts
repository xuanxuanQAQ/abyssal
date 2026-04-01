/**
 * Discovery Capability — paper search, import, and acquisition.
 *
 * Spans: external search, import papers, trigger fulltext acquisition,
 * batch operations.
 */

import type { Capability } from '../types';

export function createDiscoveryCapability(): Capability {
  return {
    name: 'discovery',
    domain: 'discovery',
    description: 'Search external databases, import papers, and acquire fulltexts',
    operations: [
      {
        name: 'search',
        description: 'Search academic databases (Semantic Scholar) for papers. Returns titles, authors, year, DOI, abstract.',
        params: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'limit', type: 'number', description: 'Max results (default 10, max 20)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.searchService) {
            return { success: false, summary: 'Search service not configured. Add API keys in settings.' };
          }
          const results = await ctx.services.searchService.searchSemanticScholar(
            params['query'] as string,
            { limit: Math.min((params['limit'] as number) ?? 10, 20) },
          );
          const list = Array.isArray(results) ? results : [];

          if (list.length > 0) {
            ctx.session.memory.add({
              type: 'finding',
              content: `Search "${params['query']}": found ${list.length} papers`,
              source: 'discovery.search',
              linkedEntities: [],
              importance: 0.4,
            });
          }

          return {
            success: true,
            data: list.slice(0, 10),
            summary: `Found ${list.length} papers matching "${params['query']}"`,
          };
        },
      },
      {
        name: 'search_knowledge',
        description: 'Semantic vector search across all indexed content (papers, notes, memos).',
        params: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'topK', type: 'number', description: 'Max results (default 10)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.ragService) {
            return { success: false, summary: 'RAG service not configured' };
          }
          const results = await ctx.services.ragService.searchSemantic(
            params['query'] as string,
            Math.min((params['topK'] as number) ?? 10, 20),
          );
          return {
            success: true,
            data: results,
            summary: 'Semantic search completed',
          };
        },
      },
      {
        name: 'retrieve',
        description: 'Full three-phase RAG pipeline: vector recall → rerank → assembly. Best for detailed, evidence-backed answers.',
        params: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'conceptIds', type: 'array', description: 'Focus on specific concepts', itemType: 'string' },
          { name: 'topK', type: 'number', description: 'Max chunks (default 10)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.ragService) {
            return { success: false, summary: 'RAG service not configured' };
          }
          const result = await ctx.services.ragService.retrieve({
            queryText: params['query'],
            conceptIds: params['conceptIds'] ?? [],
            topK: Math.min((params['topK'] as number) ?? 10, 20),
            taskType: 'ad_hoc',
          });
          const chunks = (result as Record<string, unknown>)['chunks'];
          return {
            success: true,
            data: { chunks },
            summary: `Retrieved ${Array.isArray(chunks) ? chunks.length : 0} relevant chunks`,
          };
        },
      },
      {
        name: 'import_paper',
        description: 'Import a paper into the library from search results. Optionally triggers fulltext acquisition.',
        params: [
          { name: 'title', type: 'string', description: 'Paper title', required: true },
          { name: 'authors', type: 'array', description: 'Author names', itemType: 'string' },
          { name: 'year', type: 'number', description: 'Publication year' },
          { name: 'doi', type: 'string', description: 'DOI' },
          { name: 'arxivId', type: 'string', description: 'arXiv ID' },
          { name: 'abstract', type: 'string', description: 'Abstract' },
          { name: 'venue', type: 'string', description: 'Journal/conference' },
          { name: 'acquire', type: 'boolean', description: 'Auto-download fulltext (default true)' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.addPaper) {
            return { success: false, summary: 'Paper import not available' };
          }

          const title = params['title'] as string;
          const doi = (params['doi'] as string) ?? null;

          // Dedup check
          if (doi) {
            const existing = await ctx.services.dbProxy.queryPapers({ searchText: doi, limit: 1 }) as { items: Array<Record<string, unknown>> };
            if (existing.items?.length > 0) {
              return { success: true, data: { status: 'already_exists', paperId: existing.items[0]!['id'] }, summary: 'Paper already exists' };
            }
          }

          const paper: Record<string, unknown> = {
            title,
            authors: (params['authors'] as string[]) ?? [],
            year: (params['year'] as number) ?? null,
            doi,
            arxivId: (params['arxivId'] as string) ?? null,
            abstract: (params['abstract'] as string) ?? null,
            venue: (params['venue'] as string) ?? null,
            paperType: 'unknown',
            source: 'manual',
          };
          const paperId = await ctx.services.addPaper(paper);

          // Trigger acquire
          const shouldAcquire = params['acquire'] !== false;
          let taskId: string | null = null;
          if (shouldAcquire && ctx.services.orchestrator) {
            if (ctx.services.updatePaper) {
              try { await ctx.services.updatePaper(paperId, { fulltextStatus: 'pending' }); } catch { /* best-effort */ }
            }
            const task = ctx.services.orchestrator.start('acquire', { paperIds: [paperId], concurrency: 1 });
            taskId = task.id;
          }

          ctx.eventBus.emit({ type: 'data:paperAdded', paperId, title, source: 'chat' });

          return {
            success: true,
            data: { status: 'imported', paperId, taskId },
            summary: `Imported "${title}"${taskId ? ' — fulltext acquisition started' : ''}`,
            emittedEvents: ['data:paperAdded'],
          };
        },
      },
      {
        name: 'acquire_fulltext',
        description: 'Trigger fulltext acquisition (PDF download + text extraction + indexing) for a paper in the library.',
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.orchestrator) {
            return { success: false, summary: 'Orchestrator not available' };
          }

          const paperId = params['paperId'] as string;
          const paper = await ctx.services.dbProxy.getPaper(paperId) as Record<string, unknown> | null;
          if (!paper) return { success: false, summary: `Paper ${paperId} not found` };

          const status = (paper['fulltextStatus'] ?? paper['fulltext_status']) as string;
          if (status === 'available') {
            return { success: true, data: { status: 'already_available' }, summary: 'Fulltext already available' };
          }

          if (ctx.services.updatePaper) {
            try { await ctx.services.updatePaper(paperId, { fulltextStatus: 'pending' }); } catch { /* */ }
          }

          const task = ctx.services.orchestrator.start('acquire', { paperIds: [paperId], concurrency: 1 });
          return {
            success: true,
            data: { taskId: task.id },
            summary: `Fulltext acquisition started (task: ${task.id})`,
          };
        },
      },
    ],
  };
}
