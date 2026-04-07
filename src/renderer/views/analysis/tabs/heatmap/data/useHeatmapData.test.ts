import { describe, expect, it } from 'vitest';

import { buildProcessedHeatmapSnapshot } from './useHeatmapData';

describe('buildProcessedHeatmapSnapshot', () => {
  const matrix = {
    conceptIds: ['root', 'child'],
    paperIds: ['paper-b', 'paper-a'],
    cells: [
      {
        conceptIndex: 0,
        paperIndex: 0,
        relationType: 'supports' as const,
        confidence: 0.9,
        mappingId: 'paper-b::root',
        adjudicationStatus: 'accepted' as const,
      },
      {
        conceptIndex: 0,
        paperIndex: 1,
        relationType: 'extends' as const,
        confidence: 0.6,
        mappingId: 'paper-a::root',
        adjudicationStatus: 'pending' as const,
      },
      {
        conceptIndex: 1,
        paperIndex: 0,
        relationType: 'challenges' as const,
        confidence: 0.4,
        mappingId: 'paper-b::child',
        adjudicationStatus: 'rejected' as const,
      },
    ],
  };

  const framework = {
    rootIds: ['root'],
    concepts: [
      {
        id: 'root',
        nameZh: '根概念',
        nameEn: 'Root Concept',
        definition: '',
        parentId: null,
        level: 0,
        maturity: 'established' as const,
        searchKeywords: [],
        history: [],
      },
      {
        id: 'child',
        nameZh: '子概念',
        nameEn: 'Child Concept',
        definition: '',
        parentId: 'root',
        level: 1,
        maturity: 'working' as const,
        searchKeywords: [],
        history: [],
      },
    ],
  };

  const papers = [
    {
      id: 'paper-a',
      title: 'Paper A',
      authors: [{ name: 'Alice Chen' }],
      year: 2021,
      abstract: null,
      doi: null,
      arxivId: null,
      pmcid: null,
      paperType: 'journal' as const,
      relevance: 'high' as const,
      fulltextStatus: 'available' as const,
      fulltextPath: null,
      fulltextSource: null,
      textPath: null,
      analysisStatus: 'completed' as const,
      decisionNote: null,
      failureReason: null,
      failureCount: 0,
      tags: [],
      dateAdded: '2026-01-01T00:00:00.000Z',
      analysisReport: null,
    },
    {
      id: 'paper-c',
      title: 'Paper C',
      authors: [{ name: 'Cara Lin' }],
      year: 2020,
      abstract: null,
      doi: null,
      arxivId: null,
      pmcid: null,
      paperType: 'journal' as const,
      relevance: 'medium' as const,
      fulltextStatus: 'available' as const,
      fulltextPath: null,
      fulltextSource: null,
      textPath: null,
      analysisStatus: 'completed' as const,
      decisionNote: null,
      failureReason: null,
      failureCount: 0,
      tags: [],
      dateAdded: '2026-01-01T00:00:00.000Z',
      analysisReport: null,
    },
    {
      id: 'paper-b',
      title: 'Paper B',
      authors: [{ name: 'Bob Zhao' }],
      year: 2024,
      abstract: null,
      doi: null,
      arxivId: null,
      pmcid: null,
      paperType: 'journal' as const,
      relevance: 'high' as const,
      fulltextStatus: 'available' as const,
      fulltextPath: null,
      fulltextSource: null,
      textPath: null,
      analysisStatus: 'completed' as const,
      decisionNote: null,
      failureReason: null,
      failureCount: 0,
      tags: [],
      dateAdded: '2026-01-01T00:00:00.000Z',
      analysisReport: null,
    },
  ];

  it('uses framework names and remaps cells after sorting papers', () => {
    const snapshot = buildProcessedHeatmapSnapshot({
      matrix,
      framework,
      papers,
      sortBy: 'year',
      collapsedGroups: new Set(),
    });

    expect(snapshot.sortedPaperIds).toEqual(['paper-c', 'paper-a', 'paper-b']);
    expect(snapshot.paperLabels).toEqual(['Lin 2020', 'Chen 2021', 'Zhao 2024']);
    expect(snapshot.concepts.map((concept) => concept.name)).toEqual([
      'Root Concept',
      'Child Concept',
    ]);
    expect(snapshot.cellLookup.get('0:1')).toMatchObject({
      mappingId: 'paper-a::root',
      conceptIndex: 0,
      paperIndex: 1,
    });
    expect(snapshot.cellLookup.get('1:2')).toMatchObject({
      mappingId: 'paper-b::child',
      conceptIndex: 1,
      paperIndex: 2,
    });
    expect(snapshot.cellLookup.has('0:0')).toBe(false);
  });

  it('keeps the root row visible when a concept group is collapsed', () => {
    const snapshot = buildProcessedHeatmapSnapshot({
      matrix,
      framework,
      papers,
      sortBy: 'relevance',
      collapsedGroups: new Set(['root']),
    });

    expect(snapshot.orderedConceptIds).toEqual(['root']);
    expect(snapshot.concepts).toHaveLength(1);
    expect(snapshot.concepts[0]?.name).toBe('Root Concept');
    expect(snapshot.sortedPaperIds).toEqual(['paper-a', 'paper-b', 'paper-c']);
    expect(snapshot.cellLookup.get('0:0')).toMatchObject({ mappingId: 'paper-a::root' });
    expect(snapshot.cellLookup.get('0:1')).toMatchObject({ mappingId: 'paper-b::root' });
    expect(snapshot.cellLookup.has('1:0')).toBe(false);
  });

  it('uses generic paper and concept labels instead of internal ids when metadata is missing', () => {
    const snapshot = buildProcessedHeatmapSnapshot({
      matrix: {
        conceptIds: ['raw-concept-id'],
        paperIds: ['raw-paper-id'],
        cells: [],
      },
      framework: null,
      papers: [
        {
          id: 'raw-paper-id',
          title: '',
          authors: [],
          year: 0,
          abstract: null,
          doi: null,
          arxivId: null,
          pmcid: null,
          paperType: 'journal',
          relevance: 'low',
          fulltextStatus: 'not_attempted',
          fulltextPath: null,
          fulltextSource: null,
          textPath: null,
          analysisStatus: 'not_started',
          decisionNote: null,
          failureReason: null,
          failureCount: 0,
          tags: [],
          dateAdded: '2026-01-01T00:00:00.000Z',
          analysisReport: null,
        },
      ],
      sortBy: 'relevance',
      collapsedGroups: new Set(),
    });

    expect(snapshot.paperLabels).toEqual(['Paper 1']);
    expect(snapshot.concepts.map((concept) => concept.name)).toEqual(['Concept 1']);
  });
});