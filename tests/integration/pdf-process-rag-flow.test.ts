import { describe, expect, it } from 'vitest';
import { extractSections } from '../../src/core/process/extract-sections';
import { chunkText } from '../../src/core/process/chunk-text';
import { assembleContext } from '../../src/core/rag/context-assembler';
import type { RankedChunk } from '../../src/core/types/chunk';
import type { StyledLine } from '../../src/core/process/types';

function makeStyled(text: string, fontSize = 12, isBold = false, pageIndex = 0): StyledLine {
  return { text, fontSize, isBold, pageIndex };
}

describe('pdf -> process -> rag minimal flow', () => {
  it('turns extracted sections into assembled retrieval context with memo priority', () => {
    const lines = [
      'Abstract',
      'This paper studies robust layout-aware retrieval for scientific PDFs.',
      '1 Introduction',
      'Layout-aware retrieval improves evidence quality. '.repeat(24),
      '2 Methods',
      'We combine extraction, chunking, and context assembly into a deterministic pipeline. '.repeat(18),
    ];
    const styled = [
      makeStyled(lines[0]!, 14, true),
      makeStyled(lines[1]!),
      makeStyled(lines[2]!, 14, true),
      makeStyled(lines[3]!),
      makeStyled(lines[4]!, 14, true),
      makeStyled(lines[5]!),
    ];
    const fullText = lines.join('\n');

    const { sectionMapV2, boundaries } = extractSections(fullText, styled);
    const chunks = chunkText(sectionMapV2, boundaries, [fullText], {
      paperId: 'paper-1' as never,
      maxTokensPerChunk: 64,
      overlapTokens: 16,
    });

    const rankedCandidates: RankedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      displayTitle: 'Layout Retrieval Paper',
      score: 0.95 - index * 0.05,
      rawL2Distance: null,
      originPath: 'structured',
    }));
    const forcedMemo: RankedChunk = {
      ...rankedCandidates[0]!,
      chunkId: 'memo-1' as never,
      paperId: null,
      source: 'memo',
      text: 'Priority memo: preserve introduction evidence when assembling context.',
      tokenCount: 12,
      displayTitle: 'Research memo',
      score: 1,
      originPath: 'memo',
      sectionLabel: null,
      sectionTitle: null,
      sectionType: null,
      pageStart: null,
      pageEnd: null,
      parentChunkId: null,
      chunkIndex: null,
      contextBefore: null,
      contextAfter: null,
      positionRatio: null,
    };

    const assembled = assembleContext(rankedCandidates, [forcedMemo], 600, 'broad');

    expect(chunks.length).toBeGreaterThan(1);
    expect(assembled.chunks[0]?.source).toBe('memo');
    expect(assembled.formattedContext).toContain('--- [memo] 研究者直觉 ---');
    expect(assembled.formattedContext).toContain('Priority memo: preserve introduction evidence');
    expect(assembled.formattedContext).toContain('--- [structured] Layout Retrieval Paper | Section: 1 Introduction | Pages: 0 ---');
    expect(assembled.formattedContext).toContain('Layout-aware retrieval improves evidence quality');
    expect(assembled.totalTokenCount).toBeGreaterThan(0);
  });
});