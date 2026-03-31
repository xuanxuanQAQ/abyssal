// ═══ Process Pipeline Integration Tests ═══
// End-to-end: extractSections → chunkText 全链路验证

import { describe, it, expect } from 'vitest';
import { extractSections } from './extract-sections';
import { chunkText } from './chunk-text';
import type { StyledLine } from '../types';

function makeStyled(text: string, fontSize = 12, isBold = false, pageIndex = 0): StyledLine {
  return { text, fontSize, isBold, pageIndex };
}

describe('extractSections → chunkText integration', () => {
  it('end-to-end: standard paper structure', () => {
    const sections = [
      { heading: 'Abstract', body: 'This paper presents a novel approach to text processing. We demonstrate significant improvements over baselines.' },
      { heading: '1 Introduction', body: 'Text processing is a fundamental task in NLP. ' + 'Previous work has explored various methods. '.repeat(20) },
      { heading: '2 Methods', body: 'We propose a structure-aware chunking approach. ' + 'The method operates in two phases. '.repeat(20) },
      { heading: '3 Results', body: 'Our experiments show improvements. ' + 'The results are consistent across datasets. '.repeat(20) },
      { heading: '4 Conclusion', body: 'We have presented a novel approach. Future work includes extending to multilingual settings.' },
    ];

    const lines: string[] = [];
    const styled: StyledLine[] = [];
    for (const s of sections) {
      lines.push(s.heading);
      styled.push(makeStyled(s.heading, 14, true));
      lines.push(s.body);
      styled.push(makeStyled(s.body, 12, false));
    }
    const fullText = lines.join('\n');

    // Step 1: extractSections
    const { sectionMap, sectionMapV2, boundaries } = extractSections(fullText, styled);

    expect(sectionMap.size).toBeGreaterThanOrEqual(4);
    expect(sectionMapV2.size).toBeGreaterThanOrEqual(4);

    // Verify abstract was extracted
    expect(sectionMap.has('abstract')).toBe(true);

    // Verify boundaries have charStart/charEnd
    for (const b of boundaries) {
      if (b.label !== 'abstract') {
        expect(b.charStart).toBeDefined();
        expect(b.charEnd).toBeDefined();
      }
    }

    // Step 2: chunkText with SectionMapV2
    const pageTexts = [fullText];
    const chunks = chunkText(sectionMapV2, boundaries, pageTexts, {
      maxTokensPerChunk: 128, overlapTokens: 32,
    });

    // Verify basic properties
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.text.trim().length).toBeGreaterThan(0);
      expect(c.tokenCount).toBeGreaterThan(0);
      expect(c.sectionLabel).not.toBeNull();
      if (c.pageStart != null && c.pageEnd != null) {
        expect(c.pageEnd).toBeGreaterThanOrEqual(c.pageStart);
      }
      if (c.positionRatio != null) {
        expect(c.positionRatio).toBeGreaterThanOrEqual(0);
        expect(c.positionRatio).toBeLessThanOrEqual(1);
      }
    }

    // Verify all sections are represented in chunks
    const chunkLabels = new Set(chunks.map(c => c.sectionLabel));
    expect(chunkLabels.has('abstract')).toBe(true);
    expect(chunkLabels.has('introduction')).toBe(true);
    expect(chunkLabels.has('method')).toBe(true);
  });

  it('end-to-end: backward compatible with old SectionMap', () => {
    const lines = [
      '1 Introduction',
      'Intro text content here.',
      '2 Methods',
      'Method text content here.',
    ];
    const styled = [
      makeStyled(lines[0]!, 14, true),
      makeStyled(lines[1]!),
      makeStyled(lines[2]!, 14, true),
      makeStyled(lines[3]!),
    ];
    const fullText = lines.join('\n');

    const { sectionMap, boundaries } = extractSections(fullText, styled);

    // Use old SectionMap (string values) — should still work
    const chunks = chunkText(sectionMap, boundaries, [fullText]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.sectionLabel).toBe('introduction');
  });

  it('end-to-end: multi-page document with cross-page sections', () => {
    const page1Lines = [
      '1 Introduction',
      'Introduction paragraph 1. '.repeat(30),
      'Introduction paragraph 2. '.repeat(30),
    ];
    const page2Lines = [
      'Introduction continued on page 2. '.repeat(30),
      '2 Methods',
      'Methods paragraph 1. '.repeat(30),
    ];
    const page3Lines = [
      'Methods continued on page 3. '.repeat(30),
      '3 Results',
      'Results paragraph 1. '.repeat(20),
    ];

    const page1 = page1Lines.join('\n');
    const page2 = page2Lines.join('\n');
    const page3 = page3Lines.join('\n');
    const fullText = `${page1}\n\n${page2}\n\n${page3}`;

    const allLines = fullText.split('\n');
    const styled = allLines.map((line, i) => {
      const trimmed = line.trim();
      if (/^\d\s/.test(trimmed) && trimmed.length < 30) {
        return makeStyled(trimmed, 14, true);
      }
      return makeStyled(trimmed);
    });

    const { sectionMapV2, boundaries } = extractSections(fullText, styled);
    const pageTexts = [page1, page2, page3];

    const chunks = chunkText(sectionMapV2, boundaries, pageTexts, {
      maxTokensPerChunk: 256, overlapTokens: 64,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // Verify page numbers are valid
    for (const c of chunks) {
      if (c.pageStart != null) {
        expect(c.pageStart).toBeGreaterThanOrEqual(0);
        expect(c.pageStart).toBeLessThan(pageTexts.length);
      }
      if (c.pageEnd != null) {
        expect(c.pageEnd).toBeGreaterThanOrEqual(0);
        expect(c.pageEnd).toBeLessThan(pageTexts.length);
      }
    }
  });

  it('end-to-end: document with no headings', () => {
    const text = 'This is a document with no section headings at all. '.repeat(50);
    const styled = [makeStyled(text)];

    const { sectionMap, sectionMapV2, boundaries } = extractSections(text, styled);

    // Should fallback to 'unknown'
    expect(sectionMap.has('unknown')).toBe(true);

    const chunks = chunkText(sectionMapV2, boundaries, [text], {
      maxTokensPerChunk: 128, overlapTokens: 32,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.sectionLabel).toBe('unknown');
  });

  it('end-to-end: CJK paper structure', () => {
    const lines = [
      'Abstract',
      '本文提出了一种新的文本分块方法。实验结果表明该方法显著优于基线。',
      '1 引言',
      '文本处理是自然语言处理中的基础任务。' + '先前的工作探索了各种方法。'.repeat(15),
      '2 方法',
      '我们提出了一种结构感知的分块方法。' + '该方法分两个阶段运行。'.repeat(15),
      '3 结果',
      '我们的实验表明了改进。' + '结果在各数据集上是一致的。'.repeat(15),
    ];
    const styled = [
      makeStyled(lines[0]!, 14, true),
      makeStyled(lines[1]!),
      makeStyled(lines[2]!, 14, true),
      makeStyled(lines[3]!),
      makeStyled(lines[4]!, 14, true),
      makeStyled(lines[5]!),
      makeStyled(lines[6]!, 14, true),
      makeStyled(lines[7]!),
    ];
    const fullText = lines.join('\n');

    const { sectionMapV2, boundaries } = extractSections(fullText, styled);

    // "引言" doesn't match any keyword, but "1" prefix should still create a boundary
    expect(boundaries.length).toBeGreaterThanOrEqual(3);

    const chunks = chunkText(sectionMapV2, boundaries, [fullText], {
      maxTokensPerChunk: 128, overlapTokens: 32,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.trim().length).toBeGreaterThan(0);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });
});
