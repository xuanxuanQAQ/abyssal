/**
 * Reader Capability — PDF reading pipeline operations.
 *
 * Spans: open paper, navigate pages, read content, find passages,
 * create annotations, extract claims.
 */

import type { Capability, OperationContext, OperationResult } from '../types';

export function createReaderCapability(): Capability {
  return {
    name: 'reader',
    domain: 'reader',
    description: 'PDF reading and annotation operations — open papers, navigate, highlight, extract content',
    operations: [
      {
        name: 'open_paper',
        description: 'Open a paper in the PDF reader and navigate to it. If a page is specified, scrolls to that page.',
        routeFamilies: ['ui_navigation', 'workspace_control'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID to open', required: true },
          { name: 'page', type: 'number', description: 'Page number to scroll to (1-based)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const paperId = params['paperId'] as string;
          const page = (params['page'] as number) ?? 1;

          const paper = await ctx.services.dbProxy.getPaper(paperId) as Record<string, unknown> | null;
          if (!paper) {
            return { success: false, summary: `Paper ${paperId} not found` };
          }

          ctx.eventBus.emit({
            type: 'ai:navigate',
            view: 'reader',
            target: { paperId, page },
            reason: `Opening paper: ${paper['title']}`,
          });

          return {
            success: true,
            data: { paperId, title: paper['title'], page },
            summary: `Opened paper "${paper['title']}" at page ${page}`,
            emittedEvents: ['ai:navigate'],
          };
        },
      },
      {
        name: 'get_page_content',
        description: 'Get the extracted text content of a specific page in a paper.',
        routeFamilies: ['research_qa', 'retrieval_search'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
          { name: 'page', type: 'number', description: 'Page number (1-based)', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const paperId = params['paperId'] as string;
          const page = params['page'] as number;

          if (!ctx.services.dbProxy.getChunksByPaper) {
            return { success: false, summary: 'Chunk retrieval not available' };
          }
          const allChunks = await ctx.services.dbProxy.getChunksByPaper(paperId) as Array<Record<string, unknown>>;
          // pageStart/pageEnd are 0-based in storage; page param is 1-based from API
          const page0 = page - 1;
          const pageChunks = allChunks.filter((c) => {
            const start = c['pageStart'] as number | null;
            const end = c['pageEnd'] as number | null;
            if (start == null) return false;
            return page0 >= start && page0 <= (end ?? start);
          });

          return {
            success: true,
            data: pageChunks,
            summary: pageChunks.length > 0
              ? `Retrieved ${pageChunks.length} text chunks from page ${page}`
              : `No text chunks found for page ${page}. The paper may need processing first.`,
          };
        },
      },
      {
        name: 'find_passages',
        description: 'Search for passages in a paper related to a query or concept. Uses RAG to find semantically relevant text.',
        routeFamilies: ['retrieval_search', 'research_qa'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID to search within', required: true },
          { name: 'query', type: 'string', description: 'Search query or concept description', required: true },
          { name: 'topK', type: 'number', description: 'Max passages to return (default 5)' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const paperId = params['paperId'] as string;
          const query = params['query'] as string;
          const topK = (params['topK'] as number) ?? 5;

          if (!ctx.services.ragService) {
            return { success: false, summary: 'RAG service not configured' };
          }

          const result = await ctx.services.ragService.retrieve({
            queryText: query,
            paperIds: [paperId],
            topK,
            taskType: 'ad_hoc',
            conceptIds: [],
            sectionTypeFilter: null,
            sourceFilter: null,
            budgetMode: 'focused',
            maxTokens: 50_000,
            modelContextWindow: 200_000,
            enableCorrectiveRag: false,
            relatedMemoIds: [],
          });

          const chunks = (result as Record<string, unknown>)['chunks'] as unknown[] ?? [];

          // Add findings to working memory
          if (chunks.length > 0) {
            ctx.session.memory.add({
              type: 'finding',
              content: `Found ${chunks.length} passages in paper ${paperId} related to: "${query}"`,
              source: 'reader.find_passages',
              linkedEntities: [paperId],
              importance: 0.5,
            });
          }

          return {
            success: true,
            data: { chunks, total: chunks.length },
            summary: `Found ${chunks.length} relevant passages for query "${query}"`,
          };
        },
      },
      {
        name: 'annotate',
        description: 'Create a highlight annotation on a paper. Links the annotation to the current research context.',
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
          { name: 'text', type: 'string', description: 'Text content of the annotation', required: true },
          { name: 'page', type: 'number', description: 'Page number' },
          { name: 'conceptId', type: 'string', description: 'Concept ID to link this annotation to' },
          { name: 'comment', type: 'string', description: 'Optional comment on the annotation' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.dbProxy.addAnnotation) {
            return { success: false, summary: 'Annotation service not available' };
          }

          const result = await ctx.services.dbProxy.addAnnotation(params);

          ctx.eventBus.emit({
            type: 'data:annotationCreated',
            annotationId: (result as Record<string, unknown>)?.['id'] as string ?? 'unknown',
            paperId: params['paperId'] as string,
            text: params['text'] as string,
            page: (params['page'] as number) ?? 0,
          });

          return {
            success: true,
            data: result,
            summary: `Created annotation on paper: "${(params['text'] as string).slice(0, 50)}..."`,
            emittedEvents: ['data:annotationCreated'],
          };
        },
      },
      {
        name: 'highlight_passage',
        description: 'Temporarily highlight a passage in the PDF viewer (ephemeral, not saved as annotation).',
        routeFamilies: ['ui_navigation', 'workspace_control'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
          { name: 'page', type: 'number', description: 'Page number', required: true },
          { name: 'text', type: 'string', description: 'Text to highlight', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          ctx.eventBus.emit({
            type: 'ai:highlightPassage',
            paperId: params['paperId'] as string,
            page: params['page'] as number,
            text: params['text'] as string,
            persistent: false,
          });

          return {
            success: true,
            summary: `Highlighted passage on page ${params['page']}`,
            emittedEvents: ['ai:highlightPassage'],
          };
        },
      },
      {
        name: 'get_annotations',
        description: 'Get all annotations for a paper.',
        routeFamilies: ['research_qa'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const annotations = await ctx.services.dbProxy.getAnnotations(params['paperId']);
          const list = Array.isArray(annotations) ? annotations : [];
          return {
            success: true,
            data: list,
            summary: `Retrieved ${list.length} annotations`,
          };
        },
      },
    ],
  };
}
