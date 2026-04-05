import type { NoteId } from '../types/common';

export const INTERNAL_DB_NOTE_FILE_PREFIX = '__db__/';

export function normalizeNoteFilePath(noteId: NoteId, filePath: string): string {
  const trimmedPath = filePath.trim();
  return trimmedPath.length > 0 ? trimmedPath : `${INTERNAL_DB_NOTE_FILE_PREFIX}${noteId}`;
}

export function isInternalDbNoteFilePath(filePath: string | null | undefined): boolean {
  return typeof filePath === 'string' && filePath.startsWith(INTERNAL_DB_NOTE_FILE_PREFIX);
}