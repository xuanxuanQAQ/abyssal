import { describe, expect, it } from 'vitest';

import { buildHeatmapMatrix } from './build-heatmap-matrix';

describe('buildHeatmapMatrix', () => {
  it('normalizes raw mapping rows into indexed frontend heatmap cells', async () => {
    const dbProxy = {
      getAllConcepts: async () => [
        { id: 'concept-1' },
        { id: 'concept-2' },
        { id: 'concept-3' },
      ],
      getConceptMatrix: async () => [
        {
          paperId: 'paper-b',
          conceptId: 'concept-1',
          relation: 'supports',
          confidence: 0.91,
          reviewed: true,
          decisionStatus: 'accepted',
        },
        {
          paperId: 'paper-a',
          conceptId: 'concept-2',
          relation: 'extends',
          confidence: 0.72,
          reviewed: false,
          decisionStatus: null,
        },
        {
          paperId: 'paper-b',
          conceptId: 'concept-2',
          relation: 'challenges',
          confidence: 0.44,
          reviewed: true,
          decisionStatus: 'rejected',
        },
      ],
    } as any;

    const matrix = await buildHeatmapMatrix(dbProxy);

  expect(matrix.conceptIds).toEqual(['concept-1', 'concept-2', 'concept-3']);
    expect(matrix.paperIds).toEqual(['paper-b', 'paper-a']);
    expect(matrix.cells).toEqual([
      {
        conceptIndex: 0,
        paperIndex: 0,
        relationType: 'supports',
        confidence: 0.91,
        mappingId: 'paper-b::concept-1',
        adjudicationStatus: 'accepted',
      },
      {
        conceptIndex: 1,
        paperIndex: 1,
        relationType: 'extends',
        confidence: 0.72,
        mappingId: 'paper-a::concept-2',
        adjudicationStatus: 'pending',
      },
      {
        conceptIndex: 1,
        paperIndex: 0,
        relationType: 'challenges',
        confidence: 0.44,
        mappingId: 'paper-b::concept-2',
        adjudicationStatus: 'rejected',
      },
    ]);
  });
});