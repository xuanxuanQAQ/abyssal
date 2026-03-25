// ═══ Chunk Text Tests ═══

import { describe, it, expect } from 'vitest';
import { chunkText } from './chunk-text';
import type { SectionMap, SectionBoundaryList } from '../types/chunk';

function makeSimpleSectionMap(sections: Record<string, string>): SectionMap {
  const map: SectionMap = new Map();
  for (const [label, text] of Object.entries(sections)) {
    map.set(label as any, text);
  }
  return map;
}

describe('chunkText', () => {
  it('produces at least one chunk for simple text', () => {
    const sectionMap = makeSimpleSectionMap({
      introduction: 'This is a simple introduction paragraph for testing purposes.',
    });
    const boundaries: SectionBoundaryList = [
      { lineIndex: 0, label: 'introduction', title: 'Introduction', type: 'introduction' },
    ];
    const pageTexts = ['This is a simple introduction paragraph for testing purposes.'];

    const chunks = chunkText(sectionMap, boundaries, pageTexts);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.sectionLabel).toBe('introduction');
  });

  it('returns empty for empty input', () => {
    const chunks = chunkText(new Map(), [], []);
    expect(chunks).toHaveLength(0);
  });

  it('assigns correct page numbers', () => {
    const text = 'A'.repeat(200);
    const sectionMap = makeSimpleSectionMap({ method: text });
    const boundaries: SectionBoundaryList = [
      { lineIndex: 0, label: 'method', title: 'Methods', type: null },
    ];
    const pageTexts = [text];

    const chunks = chunkText(sectionMap, boundaries, pageTexts);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.pageStart).toBe(0);
  });

  it('respects maxTokensPerChunk option', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${'word '.repeat(100)}`,
    );
    const text = paragraphs.join('\n\n');
    const sectionMap = makeSimpleSectionMap({ results: text });
    const boundaries: SectionBoundaryList = [
      { lineIndex: 0, label: 'results', title: 'Results', type: null },
    ];
    const pageTexts = [text];

    const chunks = chunkText(sectionMap, boundaries, pageTexts, {
      maxTokensPerChunk: 100,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThan(200);
    }
  });

  it('sets source to "paper" by default', () => {
    const sectionMap = makeSimpleSectionMap({
      conclusion: 'Final concluding remarks.',
    });
    const boundaries: SectionBoundaryList = [
      { lineIndex: 0, label: 'conclusion', title: 'Conclusion', type: null },
    ];
    const chunks = chunkText(sectionMap, boundaries, ['Final concluding remarks.']);
    expect(chunks.every(c => c.source === 'paper')).toBe(true);
  });

  it('assigns positionRatio between 0 and 1', () => {
    const text = 'Some text in the introduction section for testing.';
    const sectionMap = makeSimpleSectionMap({ introduction: text });
    const boundaries: SectionBoundaryList = [
      { lineIndex: 0, label: 'introduction', title: 'Introduction', type: 'introduction' },
    ];
    const chunks = chunkText(sectionMap, boundaries, [text]);
    for (const c of chunks) {
      if (c.positionRatio != null) {
        expect(c.positionRatio).toBeGreaterThanOrEqual(0);
        expect(c.positionRatio).toBeLessThanOrEqual(1);
      }
    }
  });
});
