/**
 * IPC handler: notes namespace
 *
 * Contract channels: db:notes:list, db:notes:get, db:notes:create,
 *   db:notes:updateMeta, db:notes:delete, db:notes:upgradeToConcept,
 *   db:notes:onFileChanged, fs:readNoteFile, fs:saveNoteFile
 *
 * Pushes: push:note-indexed, push:db-changed on mutations.
 */

import type { AppContext } from '../app-context';
import { typedHandler } from './register';
import { asNoteId } from '../../core/types/common';
import type { ResearchNote } from '../../core/types/note';
import type { NoteMeta } from '../../shared-types/models';

export function registerNotesHandlers(ctx: AppContext): void {
  const { logger, dbProxy } = ctx;

  const NOTE_TABLES = ['research_notes', 'chunks', 'chunks_vec'];

  // ── db:notes:list ──
  typedHandler('db:notes:list', logger, async () => {
    return await dbProxy.getAllNotes() as unknown as NoteMeta[];
  });

  // ── db:notes:get ──
  typedHandler('db:notes:get', logger, async (_e, noteId) => {
    const note = await dbProxy.getNote(asNoteId(noteId));
    if (!note) throw new Error(`Note not found: ${noteId}`);
    return note as unknown as NoteMeta;
  });

  // ── db:notes:create ──
  typedHandler('db:notes:create', logger, async (_e, note) => {
    const n = note as unknown as Record<string, unknown>;
    const noteId = asNoteId(crypto.randomUUID());
    const filePath = (n['filePath'] as string) ?? `notes/${noteId}.md`;
    await dbProxy.createNote(
      {
        id: noteId,
        title: (n['title'] as string) ?? '',
        filePath,
        linkedPaperIds: (n['linkedPaperIds'] as string[]) ?? [],
        linkedConceptIds: (n['linkedConceptIds'] as string[]) ?? [],
      } as unknown as Omit<ResearchNote, 'createdAt' | 'updatedAt'>,
      [],
      [],
    );
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'insert');
    return { noteId, filePath };
  });

  // ── db:notes:updateMeta ──
  typedHandler('db:notes:updateMeta', logger, async (_e, noteId) => {
    // TODO: DatabaseService has no updateNoteMeta method yet
    return await dbProxy.getNote(asNoteId(noteId)) as unknown as NoteMeta;
  });

  // ── db:notes:delete ──
  typedHandler('db:notes:delete', logger, async (_e, noteId) => {
    await dbProxy.deleteNote(asNoteId(noteId));
    ctx.pushManager?.enqueueDbChange(NOTE_TABLES, 'delete');
  });

  // ── db:notes:upgradeToConcept ──
  typedHandler('db:notes:upgradeToConcept', logger, async () => {
    throw new Error('Not implemented');
  });

  // ── db:notes:onFileChanged ──
  typedHandler('db:notes:onFileChanged', logger, async (_e, noteId) => {
    // TODO: re-index note file content, push note-indexed
    logger.info('Note file changed (stub)', { noteId });
  });

  // ── fs:readNoteFile ──
  typedHandler('fs:readNoteFile', logger, async () => '');

  // ── fs:saveNoteFile ──
  typedHandler('fs:saveNoteFile', logger, async () => ({
    chunksUpdated: 0,
    frontmatterValid: true,
  }));
}
