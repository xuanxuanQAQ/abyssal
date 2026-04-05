import { describe, expect, it, vi } from 'vitest';

import { createTestConfig } from '../../__test-utils__/test-db';
import { Reranker } from './reranker';
import type { RankedChunk } from '../types/chunk';

function makeCandidate(chunkId: string, score: number, text: string): RankedChunk {
  return {
    chunkId: chunkId as never,
    paperId: 'paper-1' as never,
    sectionLabel: 'introduction',
    sectionTitle: '1 Introduction',
    sectionType: 'introduction',
    pageStart: 0,
    pageEnd: 0,
    text,
    tokenCount: 20,
    source: 'paper',
    positionRatio: 0,
    parentChunkId: null,
    chunkIndex: null,
    contextBefore: null,
    contextAfter: null,
    displayTitle: 'Fallback Paper',
    score,
    rawL2Distance: null,
    originPath: 'structured',
  };
}

describe('Reranker', () => {
  it('falls back to vector-score ordering when no reranker backend is available', async () => {
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      rag: {
        ...baseConfig.rag,
        rerankerBackend: 'cohere',
      },
    });
    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    const reranker = new Reranker(
      config.rag,
      { cohereApiKey: null, jinaApiKey: null, siliconflowApiKey: null },
      logger as never,
    );

    const reranked = await reranker.rerank(
      'layout retrieval',
      [
        makeCandidate('chunk-low', 0.2, 'low score'),
        makeCandidate('chunk-high', 0.9, 'high score'),
        makeCandidate('chunk-mid', 0.5, 'mid score'),
      ],
      2,
    );

    expect(reranked.map((chunk) => chunk.chunkId)).toEqual(['chunk-high', 'chunk-mid']);
    expect(logger.warn).toHaveBeenCalledWith('No reranker available, falling back to vector score ordering');
  });
});