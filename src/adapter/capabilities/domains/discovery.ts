/**
 * Discovery Capability — paper search, import, and acquisition.
 *
 * Spans: external search, import papers, trigger fulltext acquisition,
 * batch operations.
 */

import type { Capability } from '../types';
import type { WorkflowType } from '../../../shared-types/enums';

const WORKFLOW_ACQUIRE: WorkflowType = 'acquire';

export function createDiscoveryCapability(): Capability {
  return {
    name: 'discovery',
    domain: 'discovery',
    description: 'Search external databases, import papers, and acquire fulltexts',
    operations: [
      // ── find_paper: composite tool ────────────────────────────────
      // Atomic workflow: check local library → search online → auto-import.
      // Eliminates multi-step LLM orchestration for the common "find this paper" intent.
      {
        name: 'find_paper',
        description:
          'Find a specific paper by title, DOI, or arXiv ID. ' +
          'Automatically checks the local library first; if not found, searches online academic databases and imports the best match. ' +
          'Use this when the user wants to locate and add a particular paper.',
        routeFamilies: ['discovery_online', 'retrieval_search'],
        semanticKeywords: ['搜索论文', '找文章', '查找论文', 'find paper', 'search paper', 'look up paper', '搜索这篇'],
        params: [
          { name: 'title', type: 'string', description: 'Paper title or search query', required: true },
          { name: 'doi', type: 'string', description: 'DOI identifier (if known)' },
          { name: 'arxivId', type: 'string', description: 'arXiv ID (if known)' },
          { name: 'autoImport', type: 'boolean', description: 'Automatically import the best match into library (default true)' },
          { name: 'autoAcquire', type: 'boolean', description: 'Trigger fulltext PDF download after import (default false — use acquire_fulltext separately)' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          const title = params['title'] as string;
          const doi = (params['doi'] as string) ?? null;
          const arxivId = (params['arxivId'] as string) ?? null;

          // ── Step 1: Check local library ──
          const searchText = doi || arxivId || title;
          const local = (await ctx.services.dbProxy.queryPapers({ searchText, limit: 5 })) as {
            items: Array<Record<string, unknown>>;
          };
          if (local.items?.length > 0) {
            // Coarse title similarity — if any local paper's title overlaps significantly, treat as found
            const titleLower = title.toLowerCase();
            const match = local.items.find((p) => {
              const pTitle = ((p['title'] as string) ?? '').toLowerCase();
              return pTitle === titleLower || pTitle.includes(titleLower) || titleLower.includes(pTitle);
            });
            if (match) {
              return {
                success: true,
                data: { status: 'found_local', paper: match },
                summary: `"${match['title']}" is already in your library (id: ${match['id']})`,
              };
            }
          }

          // ── Step 2: Search online ──
          if (!ctx.services.searchService) {
            return { success: false, summary: 'Search service not configured. Add API keys in settings.' };
          }
          const backend =
            ((ctx.services.configProvider?.config as Record<string, any>)?.discovery?.searchBackend as string) ??
            'openalex';
          const limit = 10;

          let results: unknown[];
          switch (backend) {
            case 'semantic_scholar':
              results = (await ctx.services.searchService.searchSemanticScholar(title, { limit })) as unknown[];
              break;
            case 'arxiv':
              results = (await ctx.services.searchService.searchArxiv(title, { limit })) as unknown[];
              break;
            case 'openalex':
            default:
              results = (await ctx.services.searchService.searchOpenAlex([title], { limit })) as unknown[];
              break;
          }
          const list = Array.isArray(results) ? results : [];

          if (list.length === 0) {
            return {
              success: true,
              data: { status: 'not_found' },
              summary: `No papers found matching "${title}" in ${backend}`,
            };
          }

          // ── Step 3: Auto-import best match ──
          const shouldImport = params['autoImport'] !== false;
          if (shouldImport && ctx.services.addPaper) {
            const best = list[0] as Record<string, unknown>;

            // Dedup by DOI before import
            const bestDoi = (best['doi'] as string) ?? null;
            if (bestDoi) {
              const dup = (await ctx.services.dbProxy.queryPapers({ searchText: bestDoi, limit: 1 })) as {
                items: Array<Record<string, unknown>>;
              };
              if (dup.items?.length > 0) {
                return {
                  success: true,
                  data: { status: 'found_local', paper: dup.items[0], otherResults: list.slice(1, 5) },
                  summary: `"${best['title']}" is already in your library`,
                };
              }
            }

            const paper: Record<string, unknown> = {
              title: best['title'],
              authors: best['authors'] ?? [],
              year: best['year'] ?? null,
              doi: bestDoi,
              arxivId: (best['arxivId'] as string) ?? null,
              abstract: best['abstract'] ?? null,
              venue: best['venue'] ?? null,
              paperType: 'unknown',
              source: 'auto_find',
            };
            const paperId = await ctx.services.addPaper(paper);

            // Trigger fulltext acquisition only if explicitly requested
            const shouldAcquire = params['autoAcquire'] === true;
            let taskId: string | null = null;
            if (shouldAcquire && ctx.services.orchestrator) {
              if (ctx.services.updatePaper) {
                try {
                  await ctx.services.updatePaper(paperId, { fulltextStatus: 'pending' });
                } catch {
                  /* best-effort */
                }
              }
              const task = ctx.services.orchestrator.start(WORKFLOW_ACQUIRE, { paperIds: [paperId], concurrency: 1 });
              taskId = task.id;
            }

            ctx.eventBus.emit({ type: 'data:paperAdded', paperId, title: best['title'] as string, source: 'chat' });

            ctx.session.memory.add({
              type: 'finding',
              content: `Found and imported "${best['title']}" via ${backend}`,
              source: 'discovery.find_paper',
              linkedEntities: [paperId],
              importance: 0.6,
            });

            return {
              success: true,
              data: {
                status: 'imported',
                paperId,
                taskId,
                paper: best,
                otherResults: list.slice(1, 5),
              },
              summary: `Found and imported "${best['title']}"${taskId ? ' — fulltext acquisition started' : ''}. ${!shouldAcquire ? 'Use acquire_fulltext to download the PDF.' : ''} ${list.length > 1 ? `Also found ${list.length - 1} other candidates.` : ''}`,
              emittedEvents: ['data:paperAdded'],
            };
          }

          // Return candidates without importing
          return {
            success: true,
            data: { status: 'found_online', results: list.slice(0, 10) },
            summary: `Found ${list.length} papers matching "${title}" in ${backend}. Use import_paper to add one to your library.`,
          };
        },
      },

      // ── search_literature: online topic exploration ───────────────
      {
        name: 'search_literature',
        description:
          'Search academic databases for papers on a topic or research area. ' +
          'Returns titles, authors, year, DOI, abstract. Does NOT auto-import. ' +
          'Use this for broad literature exploration, not for finding a specific known paper (use find_paper instead).',
        routeFamilies: ['discovery_online', 'research_qa'],
        semanticKeywords: ['搜索文献', '文献调研', '相关论文', 'literature search', 'survey', 'related work', 'explore topic'],
        params: [
          { name: 'query', type: 'string', description: 'Search query (topic, keywords)', required: true },
          { name: 'limit', type: 'number', description: 'Max results (default 10, max 20)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          if (!ctx.services.searchService) {
            return { success: false, summary: 'Search service not configured. Add API keys in settings.' };
          }
          const query = params['query'] as string;
          const limit = Math.min((params['limit'] as number) ?? 10, 20);
          const backend =
            ((ctx.services.configProvider?.config as Record<string, any>)?.discovery?.searchBackend as string) ??
            'openalex';

          let results;
          switch (backend) {
            case 'semantic_scholar':
              results = await ctx.services.searchService.searchSemanticScholar(query, { limit });
              break;
            case 'arxiv':
              results = await ctx.services.searchService.searchArxiv(query, { limit });
              break;
            case 'openalex':
            default:
              results = await ctx.services.searchService.searchOpenAlex([query], { limit });
              break;
          }
          const list = Array.isArray(results) ? results : [];

          if (list.length > 0) {
            ctx.session.memory.add({
              type: 'finding',
              content: `Literature search "${query}": found ${list.length} papers`,
              source: 'discovery.search_literature',
              linkedEntities: [],
              importance: 0.4,
            });
          }

          return {
            success: true,
            data: list.slice(0, 10),
            summary: `Found ${list.length} papers matching "${query}" in ${backend}`,
          };
        },
      },

      // ── search_knowledge: local vector search ─────────────────────
      {
        name: 'search_knowledge',
        description:
          'Semantic vector search across all indexed content in YOUR LOCAL library (papers, notes, memos). ' +
          'Does NOT search online databases. Use this to find information in papers you already have.',
        routeFamilies: ['retrieval_search', 'research_qa'],
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
        description:
          'Full three-phase RAG pipeline on YOUR LOCAL library: vector recall → rerank → assembly. ' +
          'Best for detailed, evidence-backed answers from papers you already have. Does NOT search online.',
        routeFamilies: ['retrieval_search', 'research_qa'],
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
            paperIds: [],
            sectionTypeFilter: null,
            sourceFilter: null,
            budgetMode: 'broad',
            maxTokens: 50_000,
            modelContextWindow: 200_000,
            enableCorrectiveRag: false,
            relatedMemoIds: [],
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
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'title', type: 'string', description: 'Paper title', required: true },
          { name: 'authors', type: 'array', description: 'Author names', itemType: 'string' },
          { name: 'year', type: 'number', description: 'Publication year' },
          { name: 'doi', type: 'string', description: 'DOI' },
          { name: 'arxivId', type: 'string', description: 'arXiv ID' },
          { name: 'abstract', type: 'string', description: 'Abstract' },
          { name: 'venue', type: 'string', description: 'Journal/conference' },
          { name: WORKFLOW_ACQUIRE, type: 'boolean', description: 'Auto-download fulltext (default true)' },
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
          const shouldAcquire = params[WORKFLOW_ACQUIRE] !== false;
          let taskId: string | null = null;
          if (shouldAcquire && ctx.services.orchestrator) {
            if (ctx.services.updatePaper) {
              try { await ctx.services.updatePaper(paperId, { fulltextStatus: 'pending' }); } catch { /* best-effort */ }
            }
            const task = ctx.services.orchestrator.start(WORKFLOW_ACQUIRE, { paperIds: [paperId], concurrency: 1 });
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
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID (12-char hex hash). Get IDs from query_papers.', required: true },
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

          const task = ctx.services.orchestrator.start(WORKFLOW_ACQUIRE, { paperIds: [paperId], concurrency: 1 });
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
