/**
 * Notes Capability — research notes and memos.
 *
 * Spans: create/query/update notes, create memos, link entities.
 */

import type { Capability } from '../types';

export function createNotesCapability(): Capability {
  return {
    name: 'notes',
    domain: 'notes',
    description: 'Research note and memo management — create, query, link to papers and concepts',
    operations: [
      {
        name: 'create',
        description: 'Create a new research note. Automatically links to currently active papers/concepts from the session if not specified.',
        params: [
          { name: 'title', type: 'string', description: 'Note title', required: true },
          { name: 'content', type: 'string', description: 'Note content (markdown)' },
          { name: 'linkedPaperIds', type: 'array', description: 'Paper IDs to link', itemType: 'string' },
          { name: 'linkedConceptIds', type: 'array', description: 'Concept IDs to link', itemType: 'string' },
          { name: 'tags', type: 'array', description: 'Tags', itemType: 'string' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          const noteId = globalThis.crypto.randomUUID();
          const title = params['title'] as string;
          const content = (params['content'] as string) ?? '';

          // Auto-link from session if not explicitly provided
          const linkedPaperIds = (params['linkedPaperIds'] as string[]) ??
            ctx.session.focus.activePapers.slice(0, 3);
          const linkedConceptIds = (params['linkedConceptIds'] as string[]) ??
            ctx.session.focus.activeConcepts.slice(0, 3);
          const tags = (params['tags'] as string[]) ?? [];

          // Write frontmatter + content to disk
          if (ctx.services.writeNoteFile) {
            const fmLines = [
              '---',
              `title: "${title.replace(/"/g, '\\"')}"`,
              `linkedPaperIds: ${JSON.stringify(linkedPaperIds)}`,
              `linkedConceptIds: ${JSON.stringify(linkedConceptIds)}`,
              `tags: ${JSON.stringify(tags)}`,
              '---',
              '',
            ];
            await ctx.services.writeNoteFile(noteId, fmLines.join('\n') + content);
          }

          await ctx.services.dbProxy.createNote(
            { id: noteId, title, filePath: `notes/${noteId}.md`, linkedPaperIds, linkedConceptIds, tags },
            [], [],
          );

          ctx.eventBus.emit({
            type: 'data:noteCreated',
            noteId,
            title,
            linkedPaperIds,
            linkedConceptIds,
          });

          return {
            success: true,
            data: { noteId, title, linkedPaperIds, linkedConceptIds },
            summary: `Created note "${title}" linked to ${linkedPaperIds.length} papers and ${linkedConceptIds.length} concepts`,
            emittedEvents: ['data:noteCreated'],
          };
        },
      },
      {
        name: 'create_from_findings',
        description: 'Create a note from the current working memory findings. Automatically compiles relevant findings into a structured note.',
        params: [
          { name: 'title', type: 'string', description: 'Note title', required: true },
          { name: 'findingTypes', type: 'array', description: 'Types of memory entries to include', itemType: 'string' },
          { name: 'linkedEntities', type: 'array', description: 'Entity IDs to filter findings by', itemType: 'string' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          const title = params['title'] as string;
          const types = params['findingTypes'] as string[] | undefined;
          const entities = params['linkedEntities'] as string[] | undefined;

          // Collect relevant working memory entries
          const findings = ctx.session.memory.recall({
            topK: 20,
            ...(types?.[0] !== undefined && { type: types[0] as any }),
            ...(entities?.[0] !== undefined && { linkedEntity: entities[0] }),
          });

          if (findings.length === 0) {
            return { success: false, summary: 'No findings in working memory to compile' };
          }

          // Compile findings into note content
          const contentLines = ['# ' + title, ''];
          const allLinkedPapers = new Set<string>();
          const allLinkedConcepts = new Set<string>();

          for (const f of findings) {
            contentLines.push(`- **[${f.type}]** ${f.content}`);
            for (const id of f.linkedEntities) {
              // Heuristic: 12-char hex = paper ID, shorter = concept
              if (id.length === 12) allLinkedPapers.add(id);
              else allLinkedConcepts.add(id);
            }
          }

          const content = contentLines.join('\n');
          const linkedPaperIds = Array.from(allLinkedPapers);
          const linkedConceptIds = Array.from(allLinkedConcepts);

          const noteId = globalThis.crypto.randomUUID();
          const tags = ['auto-generated'];

          // Write frontmatter + content to disk
          if (ctx.services.writeNoteFile) {
            const fmLines = [
              '---',
              `title: "${title.replace(/"/g, '\\"')}"`,
              `linkedPaperIds: ${JSON.stringify(linkedPaperIds)}`,
              `linkedConceptIds: ${JSON.stringify(linkedConceptIds)}`,
              `tags: ${JSON.stringify(tags)}`,
              '---',
              '',
            ];
            await ctx.services.writeNoteFile(noteId, fmLines.join('\n') + content);
          }

          await ctx.services.dbProxy.createNote(
            { id: noteId, title, filePath: `notes/${noteId}.md`, linkedPaperIds, linkedConceptIds, tags },
            [], [],
          );

          ctx.eventBus.emit({ type: 'data:noteCreated', noteId, title, linkedPaperIds, linkedConceptIds });

          return {
            success: true,
            data: { noteId, title, findingCount: findings.length, content },
            summary: `Created note "${title}" from ${findings.length} working memory entries`,
            emittedEvents: ['data:noteCreated'],
          };
        },
      },
      {
        name: 'query',
        description: 'Search and filter research notes by text, tags, linked papers, or linked concepts.',
        params: [
          { name: 'searchText', type: 'string', description: 'Full-text search' },
          { name: 'tags', type: 'array', description: 'Filter by tags', itemType: 'string' },
          { name: 'paperIds', type: 'array', description: 'Filter by linked paper IDs', itemType: 'string' },
          { name: 'conceptIds', type: 'array', description: 'Filter by linked concept IDs', itemType: 'string' },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const hasFilter = params['searchText'] || params['tags'] || params['paperIds'] || params['conceptIds'];
          const result = hasFilter
            ? await ctx.services.dbProxy.queryNotes(params)
            : await ctx.services.dbProxy.getAllNotes();
          const list = Array.isArray(result) ? result : [];
          return {
            success: true,
            data: list.slice(0, 20),
            summary: `Found ${list.length} notes`,
          };
        },
      },
      {
        name: 'get',
        description: 'Get a specific note by ID with full metadata.',
        params: [
          { name: 'noteId', type: 'string', description: 'Note ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const note = await ctx.services.dbProxy.getNote(params['noteId']);
          if (!note) return { success: false, summary: `Note ${params['noteId']} not found` };
          return { success: true, data: note, summary: 'Retrieved note' };
        },
      },
      {
        name: 'update',
        description: 'Update a note\'s metadata (title, tags, linked entities).',
        params: [
          { name: 'noteId', type: 'string', description: 'Note ID', required: true },
          { name: 'title', type: 'string', description: 'New title' },
          { name: 'linkedPaperIds', type: 'array', description: 'Replace linked papers', itemType: 'string' },
          { name: 'linkedConceptIds', type: 'array', description: 'Replace linked concepts', itemType: 'string' },
          { name: 'tags', type: 'array', description: 'Replace tags', itemType: 'string' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          const noteId = params['noteId'] as string;
          const patch: Record<string, unknown> = {};
          if (params['title'] !== undefined) patch['title'] = params['title'];
          if (params['linkedPaperIds'] !== undefined) patch['linkedPaperIds'] = params['linkedPaperIds'];
          if (params['linkedConceptIds'] !== undefined) patch['linkedConceptIds'] = params['linkedConceptIds'];
          if (params['tags'] !== undefined) patch['tags'] = params['tags'];

          if (Object.keys(patch).length === 0) {
            return { success: false, summary: 'No fields to update' };
          }

          const updated = await ctx.services.dbProxy.updateNoteMeta(noteId, patch);
          if (!updated) return { success: false, summary: `Note ${noteId} not found` };
          return { success: true, data: updated, summary: 'Note updated' };
        },
      },
      {
        name: 'add_memo',
        description: 'Create a quick research memo linked to a paper, concept, or annotation.',
        params: [
          { name: 'text', type: 'string', description: 'Memo content', required: true },
          { name: 'entityType', type: 'string', description: 'Entity type', required: true, enumValues: ['paper', 'concept', 'annotation'] },
          { name: 'entityId', type: 'string', description: 'Entity ID', required: true },
          { name: 'tags', type: 'array', description: 'Tags', itemType: 'string' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.dbProxy.addMemo) {
            return { success: false, summary: 'Memo service not available' };
          }
          const memo = {
            text: params['text'],
            entityType: params['entityType'],
            entityId: params['entityId'],
            tags: params['tags'] ?? [],
          };
          const result = await ctx.services.dbProxy.addMemo(memo, null);
          return { success: true, data: result, summary: `Memo created: "${(params['text'] as string).slice(0, 50)}..."` };
        },
      },
      {
        name: 'query_memos',
        description: 'Query memos by entity (paper, concept, or annotation).',
        params: [
          { name: 'entityType', type: 'string', description: 'Entity type', required: true, enumValues: ['paper', 'concept', 'annotation', 'outline'] },
          { name: 'entityId', type: 'string', description: 'Entity ID', required: true },
        ],
        permissionLevel: 0,
        execute: async (params, ctx) => {
          const memos = await ctx.services.dbProxy.getMemosByEntity(params['entityType'], params['entityId']);
          const list = Array.isArray(memos) ? memos : [];
          return {
            success: true,
            data: list.slice(0, 20),
            summary: `Found ${list.length} memos`,
          };
        },
      },
    ],
  };
}
