/**
 * Integration tests for papersDao — UPSERT, partial update, query filters,
 * cascade delete, and cross-identifier deduplication.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDB } from '../../../src/__test-utils__/test-db';
import { asPaperId, asConceptId, asChunkId } from '../../../src/core/types/common';
import type { PaperMetadata } from '../../../src/core/types/paper';
import * as papersDao from '../../../src/core/database/dao/papers';
import * as mappingsDao from '../../../src/core/database/dao/mappings';
import * as annotationsDao from '../../../src/core/database/dao/annotations';
import * as chunksDao from '../../../src/core/database/dao/chunks';
import type { ConceptMapping } from '../../../src/core/types/mapping';
import type { TextChunk } from '../../../src/core/types/chunk';

// ─── Fixture helpers ───

function makePaper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    id: asPaperId('aabbccddeeff'),
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
    year: 2017,
    doi: '10.5555/3295222.3295349',
    arxivId: '1706.03762',
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
    citationCount: 50000,
    paperType: 'conference',
    source: 'semantic_scholar',
    venue: 'NeurIPS',
    journal: null,
    volume: null,
    issue: null,
    pages: '6000-6010',
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: 'https://arxiv.org/abs/1706.03762',
    bibtexKey: 'vaswani2017attention',
    biblioComplete: true,
    ...overrides,
  };
}

function makeChunk(paperId: string, index: number): TextChunk {
  return {
    chunkId: asChunkId(`${paperId}_chunk_${index}`),
    paperId: asPaperId(paperId),
    sectionLabel: 'introduction',
    sectionTitle: 'Introduction',
    sectionType: 'introduction',
    pageStart: index,
    pageEnd: index,
    text: `This is chunk ${index} of paper ${paperId}. It contains sample text for testing.`,
    tokenCount: 20,
    source: 'paper',
    positionRatio: index * 0.25,
    parentChunkId: null,
    chunkIndex: index,
    contextBefore: null,
    contextAfter: null,
  };
}

describe('papersDao', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await createTestDB();
  });

  afterEach(() => {
    db.close();
  });

  // ─── addPaper ───

  it('addPaper inserts and returns PaperId', () => {
    const paper = makePaper();
    const id = papersDao.addPaper(db, paper);

    expect(id).toBe(paper.id);

    const stored = papersDao.getPaper(db, id);
    expect(stored).not.toBeNull();
    expect(stored!.title).toBe('Attention Is All You Need');
    expect(stored!.authors).toEqual(['Vaswani, Ashish', 'Shazeer, Noam']);
    expect(stored!.year).toBe(2017);
    expect(stored!.doi).toBe('10.5555/3295222.3295349');
    expect(stored!.paperType).toBe('conference');
    expect(stored!.source).toBe('semantic_scholar');
    expect(stored!.fulltextStatus).toBe('pending');
    expect(stored!.relevance).toBe('medium');
  });

  // ─── UPSERT merge strategies ───

  describe('addPaper UPSERT merge', () => {
    it('longer title wins', () => {
      const paper1 = makePaper({ title: 'Short' });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ title: 'A Much Longer Title That Should Win' });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.title).toBe('A Much Longer Title That Should Win');
    });

    it('more complete authors wins', () => {
      const paper1 = makePaper({ authors: ['Alice'] });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ authors: ['Alice', 'Bob', 'Charlie'] });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.authors).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('fewer authors do not overwrite more complete authors', () => {
      const paper1 = makePaper({ authors: ['Alice', 'Bob', 'Charlie'] });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ authors: ['Alice'] });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.authors).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('source is immutable (kept from first insert)', () => {
      const paper1 = makePaper({ source: 'semantic_scholar' });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ source: 'arxiv' });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.source).toBe('semantic_scholar');
    });

    it('citation_count takes MAX', () => {
      const paper1 = makePaper({ citationCount: 100 });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ citationCount: 500 });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.citationCount).toBe(500);
    });

    it('citation_count does not downgrade', () => {
      const paper1 = makePaper({ citationCount: 500 });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ citationCount: 100 });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.citationCount).toBe(500);
    });

    it('DOI cross-dedup resolves to existing id', () => {
      const paper1 = makePaper({
        id: asPaperId('111111111111'),
        doi: '10.1234/test',
        arxivId: null,
      });
      papersDao.addPaper(db, paper1);

      // A different id but same DOI should resolve to the existing paper
      const paper2 = makePaper({
        id: asPaperId('222222222222'),
        doi: '10.1234/test',
        arxivId: null,
        title: 'A Very Long Title That Should Replace Short Ones',
      });
      const effectiveId = papersDao.addPaper(db, paper2);

      expect(effectiveId).toBe(paper1.id);
      // paper2's data should have been merged into paper1
      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.title).toBe('A Very Long Title That Should Replace Short Ones');

      // paper2's original id should not exist
      const ghost = papersDao.getPaper(db, asPaperId('222222222222'));
      expect(ghost).toBeNull();
    });

    it('non-null COALESCE fills previously null fields', () => {
      const paper1 = makePaper({ venue: null, journal: null });
      papersDao.addPaper(db, paper1);

      const paper2 = makePaper({ venue: 'ICML 2024', journal: 'JMLR' });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.venue).toBe('ICML 2024');
      expect(stored.journal).toBe('JMLR');
    });

    it('biblio_complete is monotonically increasing', () => {
      const paper1 = makePaper({ biblioComplete: true });
      papersDao.addPaper(db, paper1);

      // Trying to set biblioComplete to false should not downgrade
      const paper2 = makePaper({ biblioComplete: false });
      papersDao.addPaper(db, paper2);

      const stored = papersDao.getPaper(db, paper1.id)!;
      expect(stored.biblioComplete).toBe(true);
    });
  });

  // ─── updatePaper ───

  describe('updatePaper', () => {
    it('partial update changes only specified fields', () => {
      const paper = makePaper();
      papersDao.addPaper(db, paper);

      const changes = papersDao.updatePaper(db, paper.id, {
        title: 'Updated Title',
        relevance: 'high',
      });

      expect(changes).toBe(1);

      const stored = papersDao.getPaper(db, paper.id)!;
      expect(stored.title).toBe('Updated Title');
      expect(stored.relevance).toBe('high');
      // Untouched fields remain the same
      expect(stored.authors).toEqual(['Vaswani, Ashish', 'Shazeer, Noam']);
      expect(stored.year).toBe(2017);
    });

    it('returns 0 for non-existent paper', () => {
      const changes = papersDao.updatePaper(db, asPaperId('000000000000'), {
        title: 'Ghost',
      });
      expect(changes).toBe(0);
    });

    it('returns 0 for empty updates', () => {
      const paper = makePaper();
      papersDao.addPaper(db, paper);

      const changes = papersDao.updatePaper(db, paper.id, {});
      expect(changes).toBe(0);
    });
  });

  // ─── getPaper ───

  it('getPaper returns null for missing paper', () => {
    const result = papersDao.getPaper(db, asPaperId('ffffffffffff'));
    expect(result).toBeNull();
  });

  // ─── queryPapers ───

  describe('queryPapers', () => {
    beforeEach(() => {
      papersDao.addPaper(db, makePaper({
        id: asPaperId('aaaaaaaaaaaa'),
        title: 'Deep Learning Fundamentals',
        year: 2020,
        paperType: 'journal',
        source: 'semantic_scholar',
      }), { relevance: 'high', fulltextStatus: 'acquired' });
      papersDao.addPaper(db, makePaper({
        id: asPaperId('bbbbbbbbbbbb'),
        title: 'Reinforcement Learning Survey',
        year: 2021,
        paperType: 'review',
        source: 'arxiv',
        doi: null,
        arxivId: null,
      }), { relevance: 'medium', fulltextStatus: 'pending' });
      papersDao.addPaper(db, makePaper({
        id: asPaperId('cccccccccccc'),
        title: 'Transformers in NLP',
        year: 2022,
        paperType: 'conference',
        source: 'crossref',
        doi: null,
        arxivId: null,
      }), { relevance: 'low', fulltextStatus: 'acquired' });
    });

    it('returns all papers with default filter', () => {
      const result = papersDao.queryPapers(db, {});
      expect(result.totalCount).toBe(3);
      expect(result.items).toHaveLength(3);
    });

    it('applies limit and offset', () => {
      const page1 = papersDao.queryPapers(db, { limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.totalCount).toBe(3);
      expect(page1.limit).toBe(2);
      expect(page1.offset).toBe(0);

      const page2 = papersDao.queryPapers(db, { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(1);
      expect(page2.totalCount).toBe(3);
    });

    it('filters by relevance', () => {
      const result = papersDao.queryPapers(db, { relevance: ['high'] });
      expect(result.totalCount).toBe(1);
      expect(result.items[0]!.id).toBe(asPaperId('aaaaaaaaaaaa'));
    });

    it('filters by fulltextStatus', () => {
      const result = papersDao.queryPapers(db, { fulltextStatus: ['acquired'] });
      expect(result.totalCount).toBe(2);
    });

    it('filters by paperType', () => {
      const result = papersDao.queryPapers(db, { paperType: ['review'] });
      expect(result.totalCount).toBe(1);
      expect(result.items[0]!.title).toBe('Reinforcement Learning Survey');
    });

    it('filters by yearRange', () => {
      const result = papersDao.queryPapers(db, {
        yearRange: { min: 2021, max: 2022 },
      });
      expect(result.totalCount).toBe(2);
      const years = result.items.map((p) => p.year);
      expect(years).toContain(2021);
      expect(years).toContain(2022);
    });

    it('filters by searchText in title', () => {
      const result = papersDao.queryPapers(db, { searchText: 'Reinforcement' });
      expect(result.totalCount).toBe(1);
      expect(result.items[0]!.title).toBe('Reinforcement Learning Survey');
    });

    it('sorts by year ascending', () => {
      const result = papersDao.queryPapers(db, {
        sort: { field: 'year', order: 'asc' },
      });
      expect(result.items.map((p) => p.year)).toEqual([2020, 2021, 2022]);
    });

    it('filters by specific ids', () => {
      const result = papersDao.queryPapers(db, {
        ids: [asPaperId('aaaaaaaaaaaa'), asPaperId('cccccccccccc')],
      });
      expect(result.totalCount).toBe(2);
    });

    it('filters by source', () => {
      const result = papersDao.queryPapers(db, { source: ['crossref'] });
      expect(result.totalCount).toBe(1);
      expect(result.items[0]!.id).toBe(asPaperId('cccccccccccc'));
    });

    it('combines multiple filters', () => {
      const result = papersDao.queryPapers(db, {
        fulltextStatus: ['acquired'],
        yearRange: { min: 2022 },
      });
      expect(result.totalCount).toBe(1);
      expect(result.items[0]!.title).toBe('Transformers in NLP');
    });
  });

  // ─── deletePaper ───

  describe('deletePaper cascade', () => {
    const paperId = asPaperId('aabbccddeeff');
    const conceptId = asConceptId('attention_mechanism');

    beforeEach(() => {
      // Insert paper
      papersDao.addPaper(db, makePaper({ id: paperId }));

      // Insert concept
      db.prepare(`
        INSERT INTO concepts (id, name_zh, name_en, layer, definition, search_keywords, maturity, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        conceptId, '注意力机制', 'Attention Mechanism', 'core',
        'A mechanism for neural networks.', '["attention","self-attention"]', 'established',
      );

      // Insert mapping
      mappingsDao.mapPaperConcept(db, {
        paperId,
        conceptId,
        relation: 'supports',
        confidence: 0.95,
        evidence: {
          en: 'The paper introduces self-attention.',
          original: '论文引入了自注意力机制。',
          originalLang: 'zh-CN',
          chunkId: null,
          page: 1,
          annotationId: null,
        },
        annotationId: null,
        reviewed: false,
        reviewedAt: null,
      });

      // Insert annotation
      annotationsDao.addAnnotation(db, {
        paperId,
        page: 3,
        rect: { x0: 10, y0: 20, x1: 300, y1: 40 },
        selectedText: 'Self-attention computes...',
        type: 'highlight',
        color: '#FFEB3B',
        comment: 'Key mechanism',
        conceptId: null,
        createdAt: new Date().toISOString(),
      });

      // Insert chunks (text only, no vectors since vec extension is skipped)
      chunksDao.insertChunkTextOnly(db, makeChunk(paperId, 0));
      chunksDao.insertChunkTextOnly(db, makeChunk(paperId, 1));
    });

    it('cascade removes mappings, annotations, and chunks', () => {
      // Verify data exists before delete
      const mappingsBefore = mappingsDao.getMappingsByPaper(db, paperId);
      expect(mappingsBefore).toHaveLength(1);

      const annotationsBefore = annotationsDao.getAnnotations(db, paperId);
      expect(annotationsBefore).toHaveLength(1);

      const chunksBefore = chunksDao.getChunksByPaper(db, paperId);
      expect(chunksBefore).toHaveLength(2);

      // Delete with cascade (default)
      const changes = papersDao.deletePaper(db, paperId);
      expect(changes).toBe(1);

      // Paper is gone
      expect(papersDao.getPaper(db, paperId)).toBeNull();

      // Mappings are gone
      const mappingsAfter = mappingsDao.getMappingsByPaper(db, paperId);
      expect(mappingsAfter).toHaveLength(0);

      // Annotations are gone
      const annotationsAfter = annotationsDao.getAnnotations(db, paperId);
      expect(annotationsAfter).toHaveLength(0);

      // Chunks are gone
      const chunksAfter = chunksDao.getChunksByPaper(db, paperId);
      expect(chunksAfter).toHaveLength(0);

      // Concept itself still exists (only the mapping is deleted)
      const concept = db.prepare('SELECT * FROM concepts WHERE id = ?').get(conceptId);
      expect(concept).toBeTruthy();
    });

    it('cascade removes paper_relations', () => {
      const otherId = asPaperId('112233445566');
      papersDao.addPaper(db, makePaper({
        id: otherId,
        doi: null,
        arxivId: null,
        title: 'Another Paper',
      }));

      db.prepare(`
        INSERT INTO paper_relations (source_paper_id, target_paper_id, edge_type, weight, computed_at)
        VALUES (?, ?, 'semantic_neighbor', 0.8, datetime('now'))
      `).run(paperId, otherId);

      papersDao.deletePaper(db, paperId);

      const relations = db.prepare(
        'SELECT * FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
      ).all(paperId, paperId);
      expect(relations).toHaveLength(0);
    });

    it('cascade removes citations in both directions', () => {
      const otherId = asPaperId('112233445566');
      papersDao.addPaper(db, makePaper({
        id: otherId,
        doi: null,
        arxivId: null,
        title: 'Cited Paper',
      }));

      db.prepare('INSERT INTO citations (citing_id, cited_id) VALUES (?, ?)').run(paperId, otherId);

      papersDao.deletePaper(db, paperId);

      const citations = db.prepare(
        'SELECT * FROM citations WHERE citing_id = ? OR cited_id = ?',
      ).all(paperId, paperId);
      expect(citations).toHaveLength(0);
    });
  });

  it('deletePaper returns 0 for non-existent paper', () => {
    const changes = papersDao.deletePaper(db, asPaperId('000000000000'));
    expect(changes).toBe(0);
  });

  it('deletePaper without cascade only deletes paper row', () => {
    const paper = makePaper({ id: asPaperId('aabbccddeeff') });
    papersDao.addPaper(db, paper);

    // The paper has no FKs pointing to it so non-cascade should work
    const changes = papersDao.deletePaper(db, paper.id, false);
    expect(changes).toBe(1);
    expect(papersDao.getPaper(db, paper.id)).toBeNull();
  });
});
