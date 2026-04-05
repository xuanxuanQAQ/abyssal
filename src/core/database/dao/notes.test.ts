import { createTestDB } from '../../../__test-utils__/test-db';
import { createNote, getAllNotes } from './notes';
import { INTERNAL_DB_NOTE_FILE_PREFIX } from '../note-file-path';

describe('notes dao', () => {
  it('assigns unique internal file paths for db-only notes', () => {
    const db = createTestDB();

    try {
      createNote(db, {
        id: '11111111-1111-4111-8111-111111111111',
        filePath: '',
        title: 'First note',
        linkedPaperIds: [],
        linkedConceptIds: [],
        tags: [],
        documentJson: null,
      }, [], []);

      createNote(db, {
        id: '22222222-2222-4222-8222-222222222222',
        filePath: '',
        title: 'Second note',
        linkedPaperIds: [],
        linkedConceptIds: [],
        tags: [],
        documentJson: null,
      }, [], []);

      const notes = getAllNotes(db);
      expect(notes).toHaveLength(2);
      expect(notes[0]!.filePath).toContain(INTERNAL_DB_NOTE_FILE_PREFIX);
      expect(notes[1]!.filePath).toContain(INTERNAL_DB_NOTE_FILE_PREFIX);
      expect(new Set(notes.map((note) => note.filePath)).size).toBe(2);
    } finally {
      db.close();
    }
  });
});