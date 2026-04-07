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
    routeFamilies: ['note_management', 'research_qa', 'workspace_control'],
    operations: [
      {
        name: 'create',
        description: 'Create a structured research note (long-form). Only use when the user explicitly asks to create/save a research note. Do NOT use for casual writing or quick thoughts — use add_memo instead.',
        routeFamilies: ['note_management', 'workspace_control'],
        semanticKeywords: ['创建笔记', '新建笔记', '研究笔记', 'create note', 'research note', '保存笔记', '写笔记'],
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

          // Build ProseMirror JSON from markdown content
          const documentJson = content ? JSON.stringify(markdownToProseMirrorJson(content)) : null;

          await ctx.services.dbProxy.createNote(
            { id: noteId, title, filePath: '', linkedPaperIds, linkedConceptIds, tags, documentJson },
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
        routeFamilies: ['note_management', 'workspace_control'],
        semanticKeywords: ['整理笔记', '汇总发现', 'compile findings', '生成笔记', '总结到笔记'],
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

          // Build ProseMirror JSON from compiled findings
          const documentJson = JSON.stringify(markdownToProseMirrorJson(content));

          await ctx.services.dbProxy.createNote(
            { id: noteId, title, filePath: '', linkedPaperIds, linkedConceptIds, tags, documentJson },
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
        routeFamilies: ['note_management', 'research_qa', 'retrieval_search'],
        semanticKeywords: ['查找笔记', '搜索笔记', '笔记列表', 'search notes', 'find notes', '我的笔记'],
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
        routeFamilies: ['note_management', 'research_qa'],
        semanticKeywords: ['查看笔记', '获取笔记', 'get note', '打开笔记'],
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
        routeFamilies: ['note_management', 'workspace_control'],
        semanticKeywords: ['修改笔记', '更新笔记', 'update note', '编辑笔记'],
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
        description: 'Create a quick research memo (short fragment). Preferred over create for casual thoughts, quick notes, and brief content. Can optionally link to a paper, concept, or annotation.',
        routeFamilies: ['note_management', 'workspace_control'],
        semanticKeywords: ['备忘', '随手记', '记一下', 'memo', '快速记录', '记录', '随便写', '写点东西'],
        params: [
          { name: 'text', type: 'string', description: 'Memo content', required: true },
          { name: 'entityType', type: 'string', description: 'Entity type to link (optional)', enumValues: ['paper', 'concept', 'annotation'] },
          { name: 'entityId', type: 'string', description: 'Entity ID to link (optional, required if entityType is set)' },
          { name: 'tags', type: 'array', description: 'Tags', itemType: 'string' },
        ],
        permissionLevel: 1,
        execute: async (params, ctx) => {
          if (!ctx.services.dbProxy.addMemo) {
            return { success: false, summary: 'Memo service not available' };
          }

          // Auto-link to active paper/concept from session if no entity specified
          let entityType = params['entityType'] as string | undefined;
          let entityId = params['entityId'] as string | undefined;

          if (!entityType || !entityId) {
            const activePapers = ctx.session.focus.activePapers;
            const activeConcepts = ctx.session.focus.activeConcepts;
            if (activePapers.length > 0) {
              entityType = 'paper';
              entityId = activePapers[0];
            } else if (activeConcepts.length > 0) {
              entityType = 'concept';
              entityId = activeConcepts[0];
            }
          }

          const memo = {
            text: params['text'],
            entityType: entityType ?? null,
            entityId: entityId ?? null,
            tags: params['tags'] ?? [],
          };
          const result = await ctx.services.dbProxy.addMemo(memo, null);
          return { success: true, data: result, summary: `Memo created: "${(params['text'] as string).slice(0, 50)}..."` };
        },
      },
      {
        name: 'query_memos',
        description: 'Query memos by entity (paper, concept, or annotation).',
        routeFamilies: ['note_management', 'research_qa'],
        semanticKeywords: ['查找备忘', '搜索memo', '查看备忘', 'query memos', '我的备忘'],
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

/** Convert simple markdown content to ProseMirror JSON (lightweight, no schema dependency) */
function markdownToProseMirrorJson(markdown: string): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1]!.length },
        content: [{ type: 'text', text: headingMatch[2] }],
      });
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph — collect contiguous non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.match(/^#{1,6}\s/)) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: paraLines.join('\n') }],
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'paragraph' });
  }

  return { type: 'doc', content };
}
