import { describe, expect, it } from 'vitest';

import { buildCoverageSnapshot } from './useCoverageData';

describe('buildCoverageSnapshot', () => {
  it('keeps zero-mapping framework concepts in coverage output and completeness denominator', () => {
    const snapshot = buildCoverageSnapshot({
      heatmap: {
        conceptIds: ['root', 'child'],
        paperIds: ['paper-1'],
        cells: [
          {
            conceptIndex: 1,
            paperIndex: 0,
            relationType: 'supports',
            confidence: 0.9,
            mappingId: 'paper-1::child',
            adjudicationStatus: 'accepted',
          },
        ],
      },
      papers: [
        {
          id: 'paper-1',
          title: 'Mapped paper',
          authors: [{ name: 'Alice' }],
          year: 2024,
          abstract: null,
          doi: null,
          arxivId: null,
          pmcid: null,
          paperType: 'journal',
          relevance: 'high',
          fulltextStatus: 'available',
          fulltextPath: null,
          fulltextSource: null,
          textPath: null,
          analysisStatus: 'completed',
          decisionNote: null,
          failureReason: null,
          failureCount: 0,
          tags: [],
          dateAdded: '2026-04-05T00:00:00.000Z',
          analysisReport: null,
        },
      ],
      framework: {
        rootIds: ['root'],
        concepts: [
          {
            id: 'root',
            name: 'Root Concept',
            nameZh: 'Root Concept',
            nameEn: 'Root Concept',
            description: '',
            parentId: null,
            level: 0,
            maturity: 'working',
            keywords: [],
            history: [],
          },
          {
            id: 'child',
            name: 'Child Concept',
            nameZh: 'Child Concept',
            nameEn: 'Child Concept',
            description: '',
            parentId: 'root',
            level: 1,
            maturity: 'working',
            keywords: [],
            history: [],
          },
          {
            id: 'unmapped',
            name: 'Unmapped Concept',
            nameZh: 'Unmapped Concept',
            nameEn: 'Unmapped Concept',
            description: '',
            parentId: null,
            level: 0,
            maturity: 'working',
            keywords: [],
            history: [],
          },
        ],
      },
      citedPaperIds: ['paper-1'],
    });

    expect(snapshot.concepts.map((concept) => concept.conceptId)).toEqual([
      'root',
      'child',
      'unmapped',
    ]);
    expect(snapshot.concepts.find((concept) => concept.conceptId === 'unmapped')).toMatchObject({
      total: 0,
      score: 0,
    });
    expect(snapshot.completeness).toBeCloseTo((0.7 + 0.7 + 0) / 3 * 100, 5);
  });

  it('aggregates child scores into parents without mutating the original bucket counts', () => {
    const snapshot = buildCoverageSnapshot({
      heatmap: {
        conceptIds: ['parent', 'child'],
        paperIds: ['paper-1'],
        cells: [
          {
            conceptIndex: 1,
            paperIndex: 0,
            relationType: 'supports',
            confidence: 0.92,
            mappingId: 'paper-1::child',
            adjudicationStatus: 'accepted',
          },
        ],
      },
      papers: [
        {
          id: 'paper-1',
          title: 'Child evidence',
          authors: [{ name: 'Alice' }],
          year: 2024,
          abstract: null,
          doi: null,
          arxivId: null,
          pmcid: null,
          paperType: 'journal',
          relevance: 'high',
          fulltextStatus: 'available',
          fulltextPath: null,
          fulltextSource: null,
          textPath: null,
          analysisStatus: 'completed',
          decisionNote: null,
          failureReason: null,
          failureCount: 0,
          tags: [],
          dateAdded: '2026-04-05T00:00:00.000Z',
          analysisReport: null,
        },
      ],
      framework: {
        rootIds: ['parent'],
        concepts: [
          {
            id: 'parent',
            name: 'Parent Concept',
            nameZh: 'Parent Concept',
            nameEn: 'Parent Concept',
            description: '',
            parentId: null,
            level: 0,
            maturity: 'working',
            keywords: [],
            history: [],
          },
          {
            id: 'child',
            name: 'Child Concept',
            nameZh: 'Child Concept',
            nameEn: 'Child Concept',
            description: '',
            parentId: 'parent',
            level: 1,
            maturity: 'working',
            keywords: [],
            history: [],
          },
        ],
      },
      citedPaperIds: ['paper-1'],
    });

    expect(snapshot.concepts.find((concept) => concept.conceptId === 'parent')).toMatchObject({
      synthesized: 0,
      analyzed: 0,
      acquired: 0,
      pending: 0,
      excluded: 0,
      score: 0.7,
    });
    expect(snapshot.concepts.find((concept) => concept.conceptId === 'child')).toMatchObject({
      synthesized: 1,
      score: 0.7,
    });
  });
});