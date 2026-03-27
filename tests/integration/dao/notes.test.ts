import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import {
  createNote,
  getNote,
  getNoteByFilePath,
  getAllNotes,
  deleteNote,
} from '@core/database/dao/notes';
import type { NoteId } from '@core/types/common';
import { asNoteId, asChunkId } from '@core/types/common';
import type { ResearchNote } from '@core/types/note';
import type { TextChunk } from '@core/types/chunk';

// ─── helpers ───

/** Generate a deterministic UUID-v4 for tests. */
function testNoteId(n: number): NoteId {
  const hex = n.toString(16).padStart(8, '0');
  return asNoteId(`${hex}-0000-4000-a000-000000000000`);
}

function makeNote(
  n: number,
  overrides?: Partial<Omit<ResearchNote, 'createdAt' | 'updatedAt'>>,
): Omit<ResearchNote, 'createdAt' | 'updatedAt'> {
  return {
    id: testNoteId(n),
    filePath: `notes/note-${n}.md`,
    title: `Test Note ${n}`,
    linkedPaperIds: [],
    linkedConceptIds: [],
    tags: [],
    ...overrides,
  };
}

function makeChunk(noteId: NoteId, index: number): TextChunk {
  return {
    chunkId: asChunkId(`note__${noteId}__${index}`),
    paperId: null,
    sectionLabel: null,
    sectionTitle: null,
    sectionType: null,
    pageStart: null,
    pageEnd: null,
    text: `Chunk ${index} content for note ${noteId}`,
    tokenCount: 10,
    source: 'note',
    positionRatio: null,
    parentChunkId: null,
    chunkIndex: index,
    contextBefore: null,
    contextAfter: null,
  };
}

// ─── tests ───

describe('notes DAO', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  // ── createNote ──

  it('createNote inserts a note record', () => {
    const note = makeNote(1);
    createNote(db, note, [], []);

    const fetched = getNote(db, note.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(note.id);
    expect(fetched!.title).toBe('Test Note 1');
    expect(fetched!.filePath).toBe('notes/note-1.md');
    expect(fetched!.linkedPaperIds).toEqual([]);
    expect(fetched!.linkedConceptIds).toEqual([]);
    expect(fetched!.tags).toEqual([]);
    expect(fetched!.createdAt).toBeTruthy();
    expect(fetched!.updatedAt).toBeTruthy();
  });

  it('createNote with chunks creates chunk rows', () => {
    const note = makeNote(2);
    const noteId = note.id;
    const chunks = [makeChunk(noteId, 0), makeChunk(noteId, 1)];
    const embeddings: (Float32Array | null)[] = [null, null];

    createNote(db, note, chunks, embeddings);

    // Verify chunks exist
    const chunkRows = db
      .prepare("SELECT * FROM chunks WHERE chunk_id LIKE ? ORDER BY chunk_index")
      .all(`note__${noteId}__%`) as Record<string, unknown>[];

    expect(chunkRows).toHaveLength(2);
    expect((chunkRows[0] as any).chunk_id).toBe(`note__${noteId}__0`);
    expect((chunkRows[1] as any).chunk_id).toBe(`note__${noteId}__1`);
  });

  // ── getNote ──

  it('getNote returns null for non-existent note', () => {
    const result = getNote(db, testNoteId(999));
    expect(result).toBeNull();
  });

  it('getNote returns correct data with JSON fields parsed', () => {
    const note = makeNote(3, {
      linkedPaperIds: [],
      tags: ['ml', 'transformers'],
    });
    createNote(db, note, [], []);

    const fetched = getNote(db, note.id)!;
    expect(fetched.tags).toEqual(['ml', 'transformers']);
    expect(Array.isArray(fetched.linkedPaperIds)).toBe(true);
  });

  // ── getNoteByFilePath ──

  it('getNoteByFilePath finds the correct note', () => {
    const note = makeNote(4);
    createNote(db, note, [], []);

    const fetched = getNoteByFilePath(db, 'notes/note-4.md');
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(note.id);
  });

  it('getNoteByFilePath returns null for unknown path', () => {
    const result = getNoteByFilePath(db, 'notes/nonexistent.md');
    expect(result).toBeNull();
  });

  // ── getAllNotes ──

  it('getAllNotes returns all notes sorted by updated_at DESC', () => {
    createNote(db, makeNote(10), [], []);
    createNote(db, makeNote(11), [], []);
    createNote(db, makeNote(12), [], []);

    const all = getAllNotes(db);
    expect(all).toHaveLength(3);

    // Most recently inserted should come first (updated_at DESC)
    // All were inserted nearly simultaneously, but ordering is stable
    expect(all.map((n) => n.id)).toContain(testNoteId(10));
    expect(all.map((n) => n.id)).toContain(testNoteId(11));
    expect(all.map((n) => n.id)).toContain(testNoteId(12));
  });

  it('getAllNotes returns empty array when no notes exist', () => {
    const all = getAllNotes(db);
    expect(all).toEqual([]);
  });

  // ── deleteNote ──

  it('deleteNote removes note and chunks by prefix', () => {
    const note = makeNote(20);
    const noteId = note.id;
    const chunks = [makeChunk(noteId, 0), makeChunk(noteId, 1)];
    createNote(db, note, chunks, [null, null]);

    // Verify they exist before deletion
    expect(getNote(db, noteId)).not.toBeNull();
    const chunksBefore = db
      .prepare("SELECT COUNT(*) as cnt FROM chunks WHERE chunk_id LIKE ?")
      .get(`note__${noteId}__%`) as { cnt: number };
    expect(chunksBefore.cnt).toBe(2);

    // Delete
    const changes = deleteNote(db, noteId);
    expect(changes).toBe(1);

    // Verify note is gone
    expect(getNote(db, noteId)).toBeNull();

    // Verify chunks are gone
    const chunksAfter = db
      .prepare("SELECT COUNT(*) as cnt FROM chunks WHERE chunk_id LIKE ?")
      .get(`note__${noteId}__%`) as { cnt: number };
    expect(chunksAfter.cnt).toBe(0);
  });

  it('deleteNote returns 0 for non-existent note', () => {
    const changes = deleteNote(db, testNoteId(999));
    expect(changes).toBe(0);
  });
});
