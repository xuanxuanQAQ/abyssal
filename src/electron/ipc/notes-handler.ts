/**
 * IPC handler: notes namespace
 *
 * Contract channels: db:notes:list, db:notes:get, db:notes:create,
 *   db:notes:updateMeta, db:notes:delete, db:notes:upgradeToConcept,
 *   db:notes:getContent, db:notes:saveContent
 *
 * Pushes: push:note-indexed, push:db-changed on mutations.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asNoteId, asConceptId } from '../../core/types/common';
import type { ResearchNote } from '../../core/types/note';
import type { NoteMeta, NoteFilter, SaveNoteContentResult } from '../../shared-types/models';
import type { TextChunk } from '../../core/types/chunk';
import { asChunkId } from '../../core/types/common';
import { createConceptFromDraft } from './shared/create-concept';

/** CJK + Latin mixed word counting */
function countWords(text: string): number {
  const CJK_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
  const CJK_FULL_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F]/g;

  const cjkMatches = text.match(CJK_RANGE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  const processed = text.replace(CJK_FULL_RANGE, ' ');
  const latinWords = processed.split(/\s+/).filter((w) => w.length > 0);

  return cjkCount + latinWords.length;
}

/** Extract plain text from ProseMirror JSON for word counting */
function extractTextFromJson(docJson: string | null): string {
  if (!docJson) return '';
  try {
    const doc = JSON.parse(docJson);
    const parts: string[] = [];
    function walk(node: Record<string, unknown>) {
      if (node.text) parts.push(node.text as string);
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child as Record<string, unknown>);
      }
    }
    walk(doc);
    return parts.join(' ');
  } catch { return ''; }
}

/** Convert backend ResearchNote to frontend NoteMeta shape */
function noteToFrontend(n: ResearchNote): NoteMeta {
  const text = extractTextFromJson(n.documentJson);
  return {
    id: n.id,
    title: n.title,
    linkedPaperIds: n.linkedPaperIds,
    linkedConceptIds: n.linkedConceptIds,
    tags: n.tags,
    wordCount: countWords(text),
    documentJson: n.documentJson,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** Build text chunks from plain text extracted from note JSON */
function chunkNoteBody(noteId: string, body: string): TextChunk[] {
  if (!body.trim()) return [];

  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: TextChunk[] = [];
  let buffer = '';
  let chunkIdx = 0;

  for (const para of paragraphs) {
    buffer += (buffer ? '\n\n' : '') + para;
    if (buffer.length >= 500) {
      chunks.push({
        chunkId: asChunkId(`note__${noteId}__${chunkIdx}`),
        paperId: null,
        sectionLabel: null,
        sectionTitle: null,
        sectionType: null,
        pageStart: null,
        pageEnd: null,
        text: buffer,
        tokenCount: Math.ceil(buffer.length / 4),
        source: 'note',
        positionRatio: null,
        parentChunkId: null,
        chunkIndex: chunkIdx,
        contextBefore: null,
        contextAfter: null,
      });
      buffer = '';
      chunkIdx++;
    }
  }

  if (buffer.trim()) {
    chunks.push({
      chunkId: asChunkId(`note__${noteId}__${chunkIdx}`),
      paperId: null,
      sectionLabel: null,
      sectionTitle: null,
      sectionType: null,
      pageStart: null,
      pageEnd: null,
      text: buffer,
      tokenCount: Math.ceil(buffer.length / 4),
      source: 'note',
      positionRatio: null,
      parentChunkId: null,
      chunkIndex: chunkIdx,
      contextBefore: null,
      contextAfter: null,
    });
  }

  return chunks;
}

/** Convert simple markdown to ProseMirror JSON (lightweight, no schema dependency) */
function markdownToProseMirrorJson(markdown: string): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
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
    if (!line.trim()) { i++; continue; }
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

  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

export function registerNotesHandlers(ctx: AppContext): void {
  const { logger } = ctx;

  const NOTE_TABLES = ['research_notes', 'chunks', 'chunks_vec'];

  // ── db:notes:list ──
  typedHandler('db:notes:list', logger, async (_e, filter) => {
    const f = filter as NoteFilter | undefined;
    let notes: ResearchNote[];
    if (f && (f.conceptIds?.length || f.paperIds?.length || f.tags?.length || f.searchText)) {
      notes = await ctx.dbProxy.queryNotes(f) as unknown as ResearchNote[];
    } else {
      notes = await ctx.dbProxy.getAllNotes() as unknown as ResearchNote[];
    }
    return notes.map((n) => noteToFrontend(n));
  });

  // ── db:notes:get ──
  typedHandler('db:notes:get', logger, async (_e, noteId) => {
    const note = await ctx.dbProxy.getNote(asNoteId(noteId)) as unknown as ResearchNote | null;
    if (!note) return null;
    return noteToFrontend(note);
  });

  // ── db:notes:create ──
  typedHandler('db:notes:create', logger, async (_e, note) => {
    const n = note as unknown as Record<string, unknown>;
    const noteId = asNoteId(crypto.randomUUID());

    const title = (n['title'] as string) ?? '';
    const linkedPaperIds = (n['linkedPaperIds'] as string[]) ?? [];
    const linkedConceptIds = (n['linkedConceptIds'] as string[]) ?? [];
    const tags = (n['tags'] as string[]) ?? [];

    // documentJson takes precedence; fall back to converting initialContent markdown
    let documentJson = (n['documentJson'] as string) ?? null;
    if (!documentJson && n['initialContent']) {
      documentJson = JSON.stringify(markdownToProseMirrorJson(n['initialContent'] as string));
    }

    const plainText = extractTextFromJson(documentJson);
    const chunks = chunkNoteBody(noteId, plainText);
    const embeddings = chunks.map(() => null);

    await ctx.dbProxy.createNote(
      {
        id: noteId,
        title,
        filePath: '',
        linkedPaperIds,
        linkedConceptIds,
        tags,
        documentJson,
      } as unknown as Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
      chunks,
      embeddings,
    );
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'insert');
    return { noteId };
  });

  // ── db:notes:updateMeta ──
  typedHandler('db:notes:updateMeta', logger, async (_e, noteId, patch) => {
    const p = patch as Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>;
    const updated = await ctx.dbProxy.updateNoteMeta(asNoteId(noteId), p) as unknown as ResearchNote | null;
    if (!updated) throw new Error(`Note not found: ${noteId}`);
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'update');
    return noteToFrontend(updated);
  });

  // ── db:notes:delete ──
  typedHandler('db:notes:delete', logger, async (_e, noteId) => {
    await ctx.dbProxy.deleteNote(asNoteId(noteId));
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'delete');
  });

  // ── db:notes:upgradeToConcept ──
  typedHandler('db:notes:upgradeToConcept', logger, async (_e, noteId, draft) => {
    const d = draft as unknown as Record<string, unknown>;
    const conceptId = await createConceptFromDraft(ctx.dbProxy, d);

    // Link note to concept
    await ctx.dbProxy.linkNoteToConcept(asNoteId(noteId), asConceptId(conceptId));

    ctx.pushManager?.enqueueDbChange([...NOTE_TABLES, 'concepts'], 'insert');
  });

  // ── db:notes:getContent ──
  typedHandler('db:notes:getContent', logger, async (_e, noteId) => {
    const note = await ctx.dbProxy.getNote(asNoteId(noteId)) as unknown as ResearchNote | null;
    return note?.documentJson ?? null;
  });

  // ── db:notes:saveContent ──
  typedHandler('db:notes:saveContent', logger, async (_e, noteId, documentJson) => {
    const nid = asNoteId(noteId);
    const plainText = extractTextFromJson(documentJson as string);
    const chunks = chunkNoteBody(noteId, plainText);
    const embeddings = chunks.map(() => null);

    await ctx.dbProxy.saveNoteContent(nid, documentJson as string, chunks, embeddings);

    const result: SaveNoteContentResult = { chunksUpdated: chunks.length };

    ctx.pushManager?.pushNoteIndexed({ noteId, chunkCount: chunks.length });
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'update');

    return result;
  });
}
