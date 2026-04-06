import type Database from 'better-sqlite3';
import { createTestDB } from '../../../__test-utils__/test-db';
import { getRelationGraph } from './relations';

const FIXED_TIME = '2026-04-05T00:00:00.000Z';

function insertPaper(db: Database.Database, id: string, title: string): void {
  db.prepare(
    `INSERT INTO papers (id, title, authors, year, discovered_at, updated_at)
     VALUES (?, ?, '[]', 2024, ?, ?)`,
  ).run(id, title, FIXED_TIME, FIXED_TIME);
}

function insertConcept(
  db: Database.Database,
  id: string,
  nameZh: string,
  layer = 'L2',
): void {
  db.prepare(
    `INSERT INTO concepts (id, name_zh, name_en, layer, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'definition', ?, ?)`,
  ).run(id, nameZh, `${nameZh}-en`, layer, FIXED_TIME, FIXED_TIME);
}

describe('relations dao graph pipeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  it('returns shared graph data shape and includes citation edges', () => {
    insertPaper(db, 'paper-1', 'Paper One');
    insertPaper(db, 'paper-2', 'Paper Two');
    insertPaper(db, 'paper-3', 'Paper Three');

    db.prepare(
      `INSERT INTO paper_relations (source_paper_id, target_paper_id, edge_type, weight, metadata, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('paper-1', 'paper-2', 'semantic_neighbor', 0.82, null, FIXED_TIME);

    db.prepare(
      `INSERT INTO paper_relations (source_paper_id, target_paper_id, edge_type, weight, metadata, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('paper-2', 'paper-3', 'semantic_neighbor', 0.22, null, FIXED_TIME);

    db.prepare('INSERT INTO citations (citing_id, cited_id) VALUES (?, ?)').run('paper-1', 'paper-2');

    const graph = getRelationGraph(db, {
      edgeTypes: ['citation', 'semanticNeighbor'],
      similarityThreshold: 0.5,
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'paper-1', type: 'paper', label: 'Paper One' }),
      expect.objectContaining({ id: 'paper-2', type: 'paper', label: 'Paper Two' }),
    ]));
    expect(graph.nodes.every((node) => 'label' in node)).toBe(true);
    expect(graph.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'title'))).toBe(true);

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'paper-1', target: 'paper-2', type: 'semanticNeighbor', weight: 0.82 }),
      expect.objectContaining({ source: 'paper-1', target: 'paper-2', type: 'citation', weight: 1 }),
    ]));
    expect(graph.edges.some((edge) => edge.source === 'paper-2' && edge.target === 'paper-3')).toBe(false);
  });

  it('includes concept nodes and concept mapping edges when focusing a concept', () => {
    insertPaper(db, 'paper-1', 'Focused Paper');
    insertPaper(db, 'paper-2', 'Neighbor Paper');
    insertConcept(db, 'concept-1', '概念一', 'L3');

    db.prepare(
      `INSERT INTO paper_concept_map
       (paper_id, concept_id, relation, confidence, reviewed, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run('paper-1', 'concept-1', 'supports', 0.9, FIXED_TIME, FIXED_TIME);

    db.prepare(
      `INSERT INTO paper_concept_map
       (paper_id, concept_id, relation, confidence, reviewed, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run('paper-2', 'concept-1', 'extends', 0.75, FIXED_TIME, FIXED_TIME);

    const graph = getRelationGraph(db, {
      centerId: 'concept-1',
      centerType: 'concept',
      depth: 1,
      includeConcepts: true,
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'paper-1', type: 'paper', label: 'Focused Paper' }),
      expect.objectContaining({ id: 'paper-2', type: 'paper', label: 'Neighbor Paper' }),
      expect.objectContaining({ id: 'concept-1', type: 'concept', label: '概念一', level: 3 }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'paper-1', target: 'concept-1', type: 'conceptMapping', conceptId: 'concept-1' }),
      expect.objectContaining({ source: 'paper-2', target: 'concept-1', type: 'conceptMapping', conceptId: 'concept-1' }),
    ]));
  });

  it('returns prefixed memo and note nodes with entity ids when notes are included', () => {
    insertPaper(db, 'paper-1', 'Memo Paper');

    db.prepare(
      `INSERT INTO research_memos (text, paper_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run('A memo linked to the paper', '["paper-1"]', FIXED_TIME, FIXED_TIME);

    db.prepare(
      `INSERT INTO research_notes (id, file_path, title, linked_paper_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('note-1', 'notes/note-1.md', 'Note Title', '["paper-1"]', FIXED_TIME, FIXED_TIME);

    const graph = getRelationGraph(db, {
      centerId: 'note-1',
      centerType: 'note',
      depth: 1,
      includeNotes: true,
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'note__note-1',
        type: 'note',
        label: 'Note Title',
        metadata: expect.objectContaining({ entityId: 'note-1' }),
      }),
      expect.objectContaining({
        id: 'memo__1',
        type: 'memo',
        metadata: expect.objectContaining({ entityId: '1' }),
      }),
      expect.objectContaining({ id: 'paper-1', type: 'paper', label: 'Memo Paper' }),
    ]));

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'note__note-1', target: 'paper-1', type: 'notes', weight: 1 }),
      expect.objectContaining({ source: 'memo__1', target: 'paper-1', type: 'notes', weight: 1 }),
    ]));
  });
});