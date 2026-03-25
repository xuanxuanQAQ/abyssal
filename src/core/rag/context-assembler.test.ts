// ═══ Context Assembler Tests ═══

import { describe, it, expect } from 'vitest';
import { assembleContext } from './context-assembler';
import type { RankedChunk } from '../types/chunk';
import { asChunkId, asPaperId } from '../types/common';

function makeRankedChunk(overrides: Partial<RankedChunk> = {}): RankedChunk {
  return {
    chunkId: asChunkId('chunk_test_1'),
    paperId: asPaperId('aaaaaaaaaaaa'),
    text: 'Sample text for testing.',
    tokenCount: 20,
    sectionLabel: 'introduction',
    sectionTitle: 'Introduction',
    sectionType: 'introduction',
    pageStart: 1,
    pageEnd: 1,
    source: 'paper',
    positionRatio: 0.1,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    score: 0.9,
    rawL2Distance: 0.5,
    displayTitle: 'Test Paper',
    originPath: 'vector',
    ...overrides,
  };
}

describe('assembleContext', () => {
  it('returns empty when no candidates or forced', () => {
    const result = assembleContext([], [], 1000, 'focused');
    expect(result.chunks).toHaveLength(0);
    expect(result.formattedContext).toBe('');
  });

  it('includes forced memo chunks even when budget is tight', () => {
    const memo = makeRankedChunk({
      chunkId: asChunkId('memo__1'),
      source: 'memo',
      text: 'Important research note',
      tokenCount: 10,
      displayTitle: '研究者笔记',
      originPath: 'memo',
    });
    const result = assembleContext([], [memo], 100, 'focused');
    expect(result.chunks).toHaveLength(1);
    expect(result.formattedContext).toContain('memo');
  });

  it('respects token budget — excludes chunks over budget', () => {
    const p1 = asPaperId('111111111111');
    const p2 = asPaperId('222222222222');
    const largeChunk = makeRankedChunk({
      chunkId: asChunkId('chunk_big'),
      paperId: p1,
      tokenCount: 500,
      score: 0.95,
    });
    const smallChunk = makeRankedChunk({
      chunkId: asChunkId('chunk_small'),
      paperId: p2,
      tokenCount: 10,
      score: 0.85,
    });
    // Budget only fits the small chunk
    const result = assembleContext([largeChunk, smallChunk], [], 50, 'focused');
    // Large chunk should be excluded since it exceeds budget
    expect(result.chunks.some(c => c.chunkId === 'chunk_big' as any)).toBe(false);
  });

  it('merges adjacent chunks from same paper', () => {
    const parent = asChunkId('parent_1');
    const paperId = asPaperId('bbbbbbbbbbbb');
    const c1 = makeRankedChunk({
      chunkId: asChunkId('c1'),
      paperId,
      parentChunkId: parent,
      chunkIndex: 0,
      positionRatio: 0.1,
      score: 0.9,
    });
    const c2 = makeRankedChunk({
      chunkId: asChunkId('c2'),
      paperId,
      parentChunkId: parent,
      chunkIndex: 1,
      positionRatio: 0.15,
      score: 0.8,
    });
    const result = assembleContext([c1, c2], [], 5000, 'broad');
    expect(result.chunks).toHaveLength(2);
    // Both should be included and their text merged in output
    expect(result.formattedContext).toContain(c1.text);
    expect(result.formattedContext).toContain(c2.text);
  });

  it('handles multiple chunks from same paper', () => {
    const paperId = asPaperId('cccccccccccc');
    const parent = asChunkId('parent_gap');
    const c1 = makeRankedChunk({
      chunkId: asChunkId('g1'),
      paperId,
      parentChunkId: parent,
      chunkIndex: 0,
      positionRatio: 0.1,
      tokenCount: 50,
      score: 0.9,
    });
    const c2 = makeRankedChunk({
      chunkId: asChunkId('g2'),
      paperId,
      parentChunkId: parent,
      chunkIndex: 1,
      positionRatio: 0.15,
      tokenCount: 50,
      score: 0.85,
    });
    const result = assembleContext([c1, c2], [], 5000, 'broad');
    // Both chunks from same paper should be included
    expect(result.chunks).toHaveLength(2);
  });

  it('includes contextBefore/After in broad mode', () => {
    const chunk = makeRankedChunk({
      contextBefore: 'Previous section summary',
      contextAfter: 'Next section summary',
    });
    const resultBroad = assembleContext([chunk], [], 5000, 'broad');
    expect(resultBroad.formattedContext).toContain('Previous section summary');

    const resultFocused = assembleContext([chunk], [], 5000, 'focused');
    expect(resultFocused.formattedContext).not.toContain('Previous section summary');
  });

  it('sorts paper groups by max score descending', () => {
    const highScore = makeRankedChunk({
      chunkId: asChunkId('high'),
      paperId: asPaperId('111111111111'),
      score: 0.95,
      text: 'HIGH_SCORE_PAPER',
    });
    const lowScore = makeRankedChunk({
      chunkId: asChunkId('low'),
      paperId: asPaperId('222222222222'),
      score: 0.5,
      text: 'LOW_SCORE_PAPER',
    });
    const result = assembleContext([lowScore, highScore], [], 5000, 'focused');
    const highIdx = result.formattedContext.indexOf('HIGH_SCORE_PAPER');
    const lowIdx = result.formattedContext.indexOf('LOW_SCORE_PAPER');
    expect(highIdx).toBeLessThan(lowIdx);
  });
});
