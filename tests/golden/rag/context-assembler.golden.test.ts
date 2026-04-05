import { describe, expect, it } from 'vitest';
import { assembleContext } from '../../../src/core/rag/context-assembler';
import type { RankedChunk } from '../../../src/core/types/chunk';
import { asChunkId, asPaperId } from '../../../src/core/types/common';

function makeChunk(overrides: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunkId: asChunkId('chunk-1'),
    paperId: asPaperId('aaaaaaaaaaaa'),
    text: 'Alpha evidence',
    tokenCount: 20,
    sectionLabel: 'results',
    sectionTitle: 'Results',
    sectionType: 'results',
    pageStart: 1,
    pageEnd: 1,
    source: 'paper',
    positionRatio: 0.1,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    score: 0.9,
    rawL2Distance: 0.2,
    displayTitle: 'Paper A',
    originPath: 'vector',
    ...overrides,
  };
}

describe('assembleContext golden behavior', () => {
  it('keeps deterministic ordering after deduplicating repeated chunks', () => {
    const repeated = makeChunk({ chunkId: asChunkId('dup'), text: 'Repeated evidence', score: 0.95 });
    const lower = makeChunk({ chunkId: asChunkId('other'), paperId: asPaperId('bbbbbbbbbbbb'), text: 'Secondary evidence', score: 0.7, displayTitle: 'Paper B' });

    const result = assembleContext([repeated, repeated, lower], [], 5000, 'focused');

    expect(result.chunks.map((chunk) => chunk.chunkId)).toEqual([
      asChunkId('dup'),
      asChunkId('other'),
    ]);
    const repeatedIndex = result.formattedContext.indexOf('Repeated evidence');
    const lowerIndex = result.formattedContext.indexOf('Secondary evidence');
    expect(repeatedIndex).toBeGreaterThanOrEqual(0);
    expect(repeatedIndex).toBeLessThan(lowerIndex);
  });
});
