/**
 * IPC handler: notes namespace
 *
 * Contract channels: db:notes:list, db:notes:get, db:notes:create,
 *   db:notes:updateMeta, db:notes:delete, db:notes:upgradeToConcept,
 *   db:notes:onFileChanged, fs:readNoteFile, fs:saveNoteFile
 *
 * Pushes: push:note-indexed, push:db-changed on mutations.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asNoteId, asConceptId } from '../../core/types/common';
import type { ResearchNote } from '../../core/types/note';
import type { NoteMeta, NoteFilter, SaveNoteResult } from '../../shared-types/models';
import type { TextChunk } from '../../core/types/chunk';
import { asChunkId } from '../../core/types/common';
import { createConceptFromDraft } from './shared/create-concept';

/** CJK + Latin mixed word counting (mirrors frontend countWords) */
function countWords(text: string): number {
  const CJK_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;
  const CJK_FULL_RANGE = /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F]/g;

  const cjkMatches = text.match(CJK_RANGE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  const processed = text.replace(CJK_FULL_RANGE, ' ');
  const latinWords = processed.split(/\s+/).filter((w) => w.length > 0);

  return cjkCount + latinWords.length;
}

/** Convert backend ResearchNote to frontend NoteMeta shape */
function noteToFrontend(n: ResearchNote, wordCount = 0): NoteMeta {
  return {
    id: n.id,
    title: n.title,
    filePath: n.filePath,
    linkedPaperIds: n.linkedPaperIds,
    linkedConceptIds: n.linkedConceptIds,
    tags: n.tags,
    wordCount,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** Read note file and compute word count */
async function noteToFrontendWithWordCount(
  n: ResearchNote,
  workspaceRoot: string,
): Promise<NoteMeta> {
  let wc = 0;
  try {
    const absPath = path.join(workspaceRoot, n.filePath);
    const content = await fsp.readFile(absPath, 'utf-8');
    const fm = parseFrontmatter(content);
    wc = countWords(fm.body);
  } catch { /* file may not exist yet */ }
  return noteToFrontend(n, wc);
}

/** Resolve the absolute path for a note file within the workspace */
function resolveNotePath(workspaceRoot: string, noteId: string): string {
  return path.join(workspaceRoot, 'notes', `${noteId}.md`);
}

/** Ensure the notes directory exists */
async function ensureNotesDir(workspaceRoot: string): Promise<void> {
  const notesDir = path.join(workspaceRoot, 'notes');
  await fsp.mkdir(notesDir, { recursive: true });
}

/** Simple frontmatter parser: extracts YAML between --- delimiters */
function parseFrontmatter(content: string): {
  valid: boolean;
  title?: string;
  linkedPaperIds?: string[];
  linkedConceptIds?: string[];
  tags?: string[];
  body: string;
  error?: string;
} {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(fmRegex);
  if (!match) {
    return { valid: true, body: content };
  }

  try {
    const fmBlock = match[1]!;
    const body = match[2]!;
    const result: ReturnType<typeof parseFrontmatter> = { valid: true, body };

    for (const line of fmBlock.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      switch (key) {
        case 'title':
          result.title = val.replace(/^["']|["']$/g, '');
          break;
        case 'linkedPaperIds':
        case 'linkedConceptIds':
        case 'tags':
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              (result as Record<string, unknown>)[key] = parsed;
            }
          } catch {
            // Try comma-separated
            (result as Record<string, unknown>)[key] = val
              .replace(/^\[|\]$/g, '')
              .split(',')
              .map((s: string) => s.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
          }
          break;
      }
    }
    return result;
  } catch (err) {
    return { valid: false, body: content, error: (err as Error).message };
  }
}

/** Build text chunks from note body content */
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
    return Promise.all(notes.map((n) => noteToFrontendWithWordCount(n, ctx.workspaceRoot)));
  });

  // ── db:notes:get ──
  typedHandler('db:notes:get', logger, async (_e, noteId) => {
    const note = await ctx.dbProxy.getNote(asNoteId(noteId)) as unknown as ResearchNote | null;
    if (!note) return null;
    return noteToFrontendWithWordCount(note, ctx.workspaceRoot);
  });

  // ── db:notes:create ──
  typedHandler('db:notes:create', logger, async (_e, note) => {
    const n = note as unknown as Record<string, unknown>;
    const noteId = asNoteId(crypto.randomUUID());
    const filePath = `notes/${noteId}.md`;

    const title = (n['title'] as string) ?? '';
    const linkedPaperIds = (n['linkedPaperIds'] as string[]) ?? [];
    const linkedConceptIds = (n['linkedConceptIds'] as string[]) ?? [];
    const tags = (n['tags'] as string[]) ?? [];
    const initialContent = (n['initialContent'] as string) ?? '';

    await ensureNotesDir(ctx.workspaceRoot);
    const absPath = resolveNotePath(ctx.workspaceRoot, noteId);

    const fmLines = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `linkedPaperIds: ${JSON.stringify(linkedPaperIds)}`,
      `linkedConceptIds: ${JSON.stringify(linkedConceptIds)}`,
      `tags: ${JSON.stringify(tags)}`,
      '---',
      '',
    ];
    const fileContent = fmLines.join('\n') + initialContent;
    await fsp.writeFile(absPath, fileContent, 'utf-8');

    const chunks = chunkNoteBody(noteId, initialContent);
    const embeddings = chunks.map(() => null);

    await ctx.dbProxy.createNote(
      {
        id: noteId,
        title,
        filePath,
        linkedPaperIds,
        linkedConceptIds,
        tags,
      } as unknown as Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
      chunks,
      embeddings,
    );
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'insert');
    return { noteId, filePath };
  });

  // ── db:notes:updateMeta ──
  typedHandler('db:notes:updateMeta', logger, async (_e, noteId, patch) => {
    const p = patch as Partial<Pick<ResearchNote, 'title' | 'linkedPaperIds' | 'linkedConceptIds' | 'tags'>>;
    const updated = await ctx.dbProxy.updateNoteMeta(asNoteId(noteId), p) as unknown as ResearchNote | null;
    if (!updated) throw new Error(`Note not found: ${noteId}`);
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'update');
    return noteToFrontendWithWordCount(updated, ctx.workspaceRoot);
  });

  // ── db:notes:delete ──
  typedHandler('db:notes:delete', logger, async (_e, noteId) => {
    const note = await ctx.dbProxy.getNote(asNoteId(noteId)) as unknown as ResearchNote | null;
    if (note) {
      const absPath = path.join(ctx.workspaceRoot, note.filePath);
      try { await fsp.unlink(absPath); } catch { /* file may not exist */ }
    }
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

  // ── db:notes:onFileChanged ──
  typedHandler('db:notes:onFileChanged', logger, async (_e, noteId) => {
    const nid = asNoteId(noteId);
    const note = await ctx.dbProxy.getNote(nid) as unknown as ResearchNote | null;
    if (!note) throw new Error(`Note not found: ${noteId}`);

    const absPath = path.join(ctx.workspaceRoot, note.filePath);
    let content: string;
    try {
      content = await fsp.readFile(absPath, 'utf-8');
    } catch {
      logger.warn('Note file not found on disk', { noteId, path: absPath });
      return;
    }
    const fm = parseFrontmatter(content);

    const frontmatter = {
      title: fm.title ?? note.title,
      linkedPaperIds: fm.linkedPaperIds ?? note.linkedPaperIds,
      linkedConceptIds: fm.linkedConceptIds ?? note.linkedConceptIds,
      tags: fm.tags ?? note.tags,
    } as Parameters<typeof ctx.dbProxy.onNoteFileChanged>[1];

    const chunks = chunkNoteBody(noteId, fm.body);
    const embeddings = chunks.map(() => null);

    await ctx.dbProxy.onNoteFileChanged(nid, frontmatter, chunks, embeddings);

    ctx.pushManager?.pushNoteIndexed({ noteId, chunkCount: chunks.length });
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'update');
  });

  // ── fs:readNoteFile ──
  typedHandler('fs:readNoteFile', logger, async (_e, noteId) => {
    const nid = asNoteId(noteId);
    const note = await ctx.dbProxy.getNote(nid) as unknown as ResearchNote | null;

    try {
      if (note) {
        const absPath = path.join(ctx.workspaceRoot, note.filePath);
        return await fsp.readFile(absPath, 'utf-8');
      }
    } catch { /* fall through to fallback */ }

    try {
      const fallbackPath = resolveNotePath(ctx.workspaceRoot, noteId);
      return await fsp.readFile(fallbackPath, 'utf-8');
    } catch (err) {
      logger.warn('Failed to read note file', { noteId, error: (err as Error).message });
    }

    return '';
  });

  // ── fs:saveNoteFile ──
  typedHandler('fs:saveNoteFile', logger, async (_e, noteId, content) => {
    const nid = asNoteId(noteId);
    const note = await ctx.dbProxy.getNote(nid) as unknown as ResearchNote | null;

    const absPath = note
      ? path.join(ctx.workspaceRoot, note.filePath)
      : resolveNotePath(ctx.workspaceRoot, noteId);

    // Atomic write: temp file + rename to prevent data loss on crash
    await ensureNotesDir(ctx.workspaceRoot);
    const tmpPath = absPath + '.tmp';
    try {
      await fsp.writeFile(tmpPath, content as string, 'utf-8');
      await fsp.rename(tmpPath, absPath);
    } catch (err) {
      try { await fsp.unlink(tmpPath); } catch { /* ignore */ }
      logger.error('Failed to write note file', err as Error, { noteId });
      throw err;
    }

    // Parse frontmatter and re-index
    const fm = parseFrontmatter(content as string);
    const result: SaveNoteResult = {
      chunksUpdated: 0,
      frontmatterValid: fm.valid,
      ...(fm.error != null ? { frontmatterError: fm.error } : {}),
    };

    if (note) {
      const frontmatter = {
        title: fm.title ?? note.title,
        linkedPaperIds: fm.linkedPaperIds ?? note.linkedPaperIds,
        linkedConceptIds: fm.linkedConceptIds ?? note.linkedConceptIds,
        tags: fm.tags ?? note.tags,
      } as Parameters<typeof ctx.dbProxy.onNoteFileChanged>[1];

      const chunks = chunkNoteBody(noteId, fm.body);
      const embeddings = chunks.map(() => null);

      await ctx.dbProxy.onNoteFileChanged(nid, frontmatter, chunks, embeddings);
      result.chunksUpdated = chunks.length;

      ctx.pushManager?.pushNoteIndexed({ noteId, chunkCount: chunks.length });
      ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'update');
    }

    return result;
  });
}
