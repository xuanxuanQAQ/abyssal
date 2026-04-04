import {
  shouldUseCompactMode,
  COMPACT_MODE_THRESHOLD,
  compactConceptFormat,
  compactMemos,
  compactAnnotations,
  ultraCompressFulltext,
  compactRagPassages,
} from './compact-mode';

import type { ConceptForSubset } from './concept-subset-selector';
import type { MemoForInjection } from './memo-injector';
import type { AnnotationForInjection } from './annotation-injector';
import type { RagPassage } from './retrieval-formatter';

// ─── shouldUseCompactMode ───

describe('shouldUseCompactMode', () => {
  it('returns true for budget below threshold', () => {
    expect(shouldUseCompactMode(COMPACT_MODE_THRESHOLD - 1)).toBe(true);
    expect(shouldUseCompactMode(500)).toBe(true);
    expect(shouldUseCompactMode(0)).toBe(true);
  });

  it('returns false for budget at or above threshold', () => {
    expect(shouldUseCompactMode(COMPACT_MODE_THRESHOLD)).toBe(false);
    expect(shouldUseCompactMode(COMPACT_MODE_THRESHOLD + 1)).toBe(false);
    expect(shouldUseCompactMode(10000)).toBe(false);
  });
});

// ─── compactConceptFormat ───

describe('compactConceptFormat', () => {
  it('formats concepts with name and truncated definition', () => {
    const concepts: ConceptForSubset[] = [
      { id: 'c-1', nameEn: 'Goal Setting', nameZh: '目标设定', definition: 'The process of establishing targets', searchKeywords: ['goal'], maturity: 'working' },
    ];
    const result = compactConceptFormat(concepts);
    expect(result).toContain('# Concepts (compact)');
    expect(result).toContain('**Goal Setting**');
    expect(result).toContain('The process of establishing targets');
  });

  it('truncates definition at 200 chars', () => {
    const longDef = 'x'.repeat(300);
    const concepts: ConceptForSubset[] = [
      { id: 'c-1', nameEn: 'Test', nameZh: '测试', definition: longDef, searchKeywords: [], maturity: 'working' },
    ];
    const result = compactConceptFormat(concepts);
    expect(result).toContain('x'.repeat(200));
    expect(result).not.toContain('x'.repeat(201));
  });
});

// ─── compactMemos ───

describe('compactMemos', () => {
  it('limits to 3 memos', () => {
    const memos: MemoForInjection[] = Array.from({ length: 5 }, (_, i) => ({
      text: `Memo ${i}`,
      createdAt: '2025-01-01',
      conceptIds: [],
      paperIds: [],
    }));
    expect(compactMemos(memos)).toHaveLength(3);
  });

  it('truncates memo text to 120 chars + ellipsis', () => {
    const memos: MemoForInjection[] = [{
      text: 'a'.repeat(200),
      createdAt: '2025-01-01',
      conceptIds: [],
      paperIds: [],
    }];
    const result = compactMemos(memos);
    expect(result[0]!.text).toBe('a'.repeat(120) + '...');
  });

  it('does not add ellipsis if text is within limit', () => {
    const memos: MemoForInjection[] = [{
      text: 'Short memo',
      createdAt: '2025-01-01',
      conceptIds: [],
      paperIds: [],
    }];
    const result = compactMemos(memos);
    expect(result[0]!.text).toBe('Short memo');
  });

  it('returns empty array for empty input', () => {
    expect(compactMemos([])).toEqual([]);
  });
});

// ─── compactAnnotations ───

describe('compactAnnotations', () => {
  it('limits to 3 annotations', () => {
    const anns: AnnotationForInjection[] = Array.from({ length: 5 }, (_, i) => ({
      text: `Ann ${i}`,
      page: i,
    }));
    expect(compactAnnotations(anns)).toHaveLength(3);
  });

  it('returns all if ≤3', () => {
    const anns: AnnotationForInjection[] = [{ text: 'first' }, { text: 'second' }];
    expect(compactAnnotations(anns)).toHaveLength(2);
  });
});

// ─── ultraCompressFulltext ───

describe('ultraCompressFulltext', () => {
  it('returns first 3000 chars + truncation notice when no sectionMap', () => {
    const longText = 'w'.repeat(5000);
    const result = ultraCompressFulltext(longText, null);
    expect(result).toContain('w'.repeat(3000));
    expect(result).toContain('[... truncated for compact mode ...]');
  });

  it('returns first 3000 chars when sectionMap is empty', () => {
    const result = ultraCompressFulltext('short text', []);
    expect(result).toContain('short text');
  });

  it('includes abstract and first paragraph of body sections', () => {
    const text = 'This is abstract content.\n\nBody section paragraph 1.\n\nParagraph 2.\n\nConclusion text.';
    const sectionMap = [
      { title: 'Abstract', sectionType: 'abstract' as const, startOffset: 0, endOffset: 25 },
      { title: 'Introduction', sectionType: 'introduction' as const, startOffset: 27, endOffset: 70 },
    ];
    const result = ultraCompressFulltext(text, sectionMap);
    expect(result).toContain('This is abstract content.');
    expect(result).toContain('Introduction');
  });

  it('excludes references and acknowledgments sections', () => {
    const text = 'Abstract.\n\nReferences.\n\nAcknowledgments.';
    const sectionMap = [
      { title: 'Abstract', sectionType: 'abstract' as const, startOffset: 0, endOffset: 9 },
      { title: 'References', sectionType: 'references' as const, startOffset: 11, endOffset: 22 },
      { title: 'Ack', sectionType: 'acknowledgments' as const, startOffset: 24, endOffset: 39 },
    ];
    const result = ultraCompressFulltext(text, sectionMap);
    expect(result).not.toContain('**References**');
    expect(result).not.toContain('**Ack**');
  });
});

// ─── compactRagPassages ───

describe('compactRagPassages', () => {
  it('returns empty for empty input', () => {
    expect(compactRagPassages([])).toEqual([]);
  });

  it('returns highest score passage', () => {
    const passages: RagPassage[] = [
      { paperId: 'p1', paperTitle: 'Paper 1', text: 'low', score: 0.5, tokenCount: 10, source: 'paper' },
      { paperId: 'p2', paperTitle: 'Paper 2', text: 'high', score: 0.9, tokenCount: 10, source: 'paper' },
    ];
    const result = compactRagPassages(passages);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(0.9);
  });
});
