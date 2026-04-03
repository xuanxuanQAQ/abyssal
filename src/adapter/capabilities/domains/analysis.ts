/**
 * Analysis Capability — concept extraction, paper analysis, comparison.
 *
 * Spans: get paper/concept details, trigger analysis pipeline,
 * compare papers, find concept relationships.
 */

import type { Capability } from '../types';

export function createAnalysisCapability(): Capability {
  return {
    name: 'analysis',
    domain: 'analysis',
    description: 'Paper analysis, concept management, and knowledge synthesis operations',
    routeFamilies: ['research_qa', 'workspace_control'],
    operations: [
      {
        name: 'get_paper',
        description: 'Get detailed metadata for a paper including title, authors, abstract, analysis status, and fulltext status.',
        routeFamilies: ['research_qa'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const paper = await ctx.services.dbProxy.getPaper(params['paperId']);
          if (!paper) return { success: false, summary: `Paper ${params['paperId']} not found` };
          return { success: true, data: paper, summary: `Retrieved paper details` };
        },
      },
      {
        name: 'query_papers',
        description: 'Search and filter papers in the library by text, relevance, status, or tags.',
        routeFamilies: ['research_qa', 'retrieval_search'],
        params: [
          { name: 'searchText', type: 'string', description: 'Full-text search query' },
          { name: 'limit', type: 'number', description: 'Max results (default 20)' },
          { name: 'offset', type: 'number', description: 'Pagination offset' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const result = await ctx.services.dbProxy.queryPapers(params);
          return { success: true, data: result, summary: 'Query completed' };
        },
      },
      {
        name: 'get_concept',
        description: 'Get concept definition, maturity, keywords, and mapping count.',
        routeFamilies: ['research_qa'],
        params: [
          { name: 'conceptId', type: 'string', description: 'Concept ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const concept = await ctx.services.dbProxy.getConcept(params['conceptId']);
          if (!concept) return { success: false, summary: `Concept ${params['conceptId']} not found` };
          return { success: true, data: concept, summary: 'Retrieved concept details' };
        },
      },
      {
        name: 'get_concept_matrix',
        description: 'Get the concept-paper mapping matrix showing which papers discuss which concepts.',
        routeFamilies: ['research_qa'],
        params: [],
        permissionLevel: 0,
        execute: async (_params, ctx) => {
          const matrix = await ctx.services.dbProxy.getConceptMatrix();
          return { success: true, data: matrix, summary: 'Retrieved concept matrix' };
        },
      },
      {
        name: 'run_analysis',
        description: 'Trigger the analysis pipeline on one or more papers. Extracts concepts, mappings, and relationships.',
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'paperIds', type: 'array', description: 'Paper IDs to analyze', required: true, itemType: 'string' },
          { name: 'concurrency', type: 'number', description: 'Parallel analysis threads (default 2)' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.orchestrator) {
            return { success: false, summary: 'Orchestrator not available' };
          }
          const paperIds = params['paperIds'] as string[];
          const task = ctx.services.orchestrator.start('analyze', {
            paperIds,
            concurrency: (params['concurrency'] as number) ?? 2,
          });

          ctx.eventBus.emit({
            type: 'pipeline:started',
            taskId: task.id,
            workflow: 'analyze',
            paperIds,
          });

          return {
            success: true,
            data: { taskId: task.id, paperCount: paperIds.length },
            summary: `Analysis pipeline started for ${paperIds.length} papers (task: ${task.id})`,
            emittedEvents: ['pipeline:started'],
          };
        },
      },
      {
        name: 'get_suggestions',
        description: 'Get AI-suggested concepts that emerged from paper analysis but haven\'t been adopted yet.',
        routeFamilies: ['research_qa'],
        params: [],
        permissionLevel: 0,
        execute: async (_params, ctx) => {
          const suggestions = await ctx.services.dbProxy.getSuggestedConcepts();
          return {
            success: true,
            data: suggestions,
            summary: `Retrieved ${Array.isArray(suggestions) ? suggestions.length : 0} concept suggestions`,
          };
        },
      },
      {
        name: 'adopt_suggestion',
        description: 'Accept an AI-suggested concept into the research framework.',
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'suggestionId', type: 'string', description: 'Suggestion ID to adopt', required: true },
        ],
        permissionLevel: 2,
        execute: async (params, ctx) => {
          if (!ctx.services.dbProxy.adoptSuggestedConcept) {
            return { success: false, summary: 'Concept adoption not available' };
          }
          if (ctx.services.confirmWrite) {
            const approved = await ctx.services.confirmWrite(
              'adopt_suggestion',
              `Adopt suggested concept ${params['suggestionId']}?`,
              params,
            );
            if (!approved) return { success: false, summary: 'User declined' };
          }
          const result = await ctx.services.dbProxy.adoptSuggestedConcept(params['suggestionId']);
          return { success: true, data: result, summary: 'Concept suggestion adopted' };
        },
      },
      {
        name: 'adjudicate_mapping',
        description: 'Accept, reject, or revise a paper-concept mapping.',
        routeFamilies: ['workspace_control'],
        params: [
          { name: 'paperId', type: 'string', description: 'Paper ID', required: true },
          { name: 'conceptId', type: 'string', description: 'Concept ID', required: true },
          { name: 'decision', type: 'string', description: 'Decision', required: true, enumValues: ['accepted', 'rejected', 'revised'] },
          { name: 'note', type: 'string', description: 'Reason for the decision' },
        ],
        permissionLevel: 2,
        execute: async (params, ctx) => {
          if (!ctx.services.dbProxy.adjudicateMapping) {
            return { success: false, summary: 'Mapping adjudication not available' };
          }
          if (ctx.services.confirmWrite) {
            const approved = await ctx.services.confirmWrite(
              'adjudicate_mapping',
              `${params['decision']} mapping: paper ${params['paperId']} ↔ concept ${params['conceptId']}`,
              params,
            );
            if (!approved) return { success: false, summary: 'User declined' };
          }
          const result = await ctx.services.dbProxy.adjudicateMapping(
            params['paperId'], params['conceptId'], params['decision'], { note: params['note'] },
          );
          return { success: true, data: result, summary: `Mapping ${params['decision']}` };
        },
      },
      {
        name: 'get_stats',
        description: 'Get project-wide statistics: paper count, concept count, analysis coverage.',
        routeFamilies: ['research_qa', 'config_diagnostic'],
        params: [],
        permissionLevel: 0,
        execute: async (_params, ctx) => {
          const stats = await ctx.services.dbProxy.getStats();
          return { success: true, data: stats, summary: 'Retrieved project statistics' };
        },
      },
    ],
  };
}
