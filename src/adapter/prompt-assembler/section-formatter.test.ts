import {
  formatSectionBlock,
  formatAnnotations,
  formatMemos,
  formatConceptFramework,
  formatRagPassages,
  formatAdjudicationHistory,
  formatEvidenceGaps,
  formatProtectedParagraphs,
  type AnnotationForFormat,
  type MemoForFormat,
  type ConceptForFormat,
  type RagPassageForFormat,
  type AdjudicationForFormat,
} from './section-formatter';

// ─── formatSectionBlock ───

describe('formatSectionBlock', () => {
  it('wraps content with H2 header', () => {
    const result = formatSectionBlock('Context', 'Some text', 'paper_fulltext', 'HIGH', 100);
    expect(result).toBe('## Context\n\nSome text');
  });

  it('returns empty string for empty content', () => {
    expect(formatSectionBlock('Title', '', 'paper_fulltext', 'HIGH', 0)).toBe('');
    expect(formatSectionBlock('Title', '   ', 'paper_fulltext', 'HIGH', 0)).toBe('');
  });
});

// ─── formatAnnotations ───

describe('formatAnnotations', () => {
  it('returns empty string for no annotations', () => {
    expect(formatAnnotations([])).toBe('');
  });

  it('formats annotation with page and type', () => {
    const ann: AnnotationForFormat = { page: 5, annotationType: 'note', selectedText: 'key insight' };
    const result = formatAnnotations([ann]);
    expect(result).toContain('⭐ [Page 5] note');
    expect(result).toContain('Text: "key insight"');
  });

  it('shows "Page ?" for undefined page', () => {
    const result = formatAnnotations([{ selectedText: 'text' }]);
    expect(result).toContain('[Page ?]');
  });

  it('defaults annotation type to highlight', () => {
    const result = formatAnnotations([{ selectedText: 'text' }]);
    expect(result).toContain('] highlight');
  });

  it('includes comment and concept when present', () => {
    const ann: AnnotationForFormat = {
      selectedText: 'text',
      comment: 'important',
      conceptId: 'c-1',
      conceptName: 'Agency',
    };
    const result = formatAnnotations([ann]);
    expect(result).toContain('Note: "important"');
    expect(result).toContain('Concept: Agency');
  });

  it('omits concept when only conceptId is present (not conceptName)', () => {
    const ann: AnnotationForFormat = { selectedText: 'text', conceptId: 'c-1' };
    const result = formatAnnotations([ann]);
    expect(result).not.toContain('Concept:');
  });
});

// ─── formatMemos ───

describe('formatMemos', () => {
  it('returns empty string for no memos', () => {
    expect(formatMemos([])).toBe('');
  });

  it('formats memo with date and text', () => {
    const memo: MemoForFormat = {
      text: 'Self-regulation relates to motivation',
      createdAt: '2025-03-15T12:00:00Z',
      conceptIds: [],
      paperIds: [],
    };
    const result = formatMemos([memo]);
    expect(result).toContain('[2025-03-15]');
    expect(result).toContain('Self-regulation relates to motivation');
  });

  it('includes related concepts', () => {
    const memo: MemoForFormat = {
      text: 'Note',
      createdAt: '2025-01-01',
      conceptIds: ['c-agency', 'c-motivation'],
      paperIds: [],
    };
    const result = formatMemos([memo]);
    expect(result).toContain('Related concepts: c-agency, c-motivation');
  });

  it('includes related papers excluding current paper', () => {
    const memo: MemoForFormat = {
      text: 'Note',
      createdAt: '2025-01-01',
      conceptIds: [],
      paperIds: ['p1', 'p2', 'p3'],
    };
    const result = formatMemos([memo], 'p2');
    expect(result).toContain('Also relates to papers: p1, p3');
    expect(result).not.toContain('p2');
  });
});

// ─── formatConceptFramework ───

describe('formatConceptFramework', () => {
  it('returns empty string for no concepts', () => {
    expect(formatConceptFramework([])).toBe('');
  });

  it('formats concept with all fields', () => {
    const concept: ConceptForFormat = {
      id: 'c-1',
      nameEn: 'Self-Regulation',
      nameZh: '自我调节',
      definition: 'Ability to manage behavior',
      searchKeywords: ['SRL', 'self-regulation'],
      maturity: 'working',
    };
    const result = formatConceptFramework([concept]);
    expect(result).toContain('### Self-Regulation (自我调节)');
    expect(result).toContain('**ID**: c-1');
    expect(result).toContain('**Definition**: Ability to manage behavior');
    expect(result).toContain('**Keywords**: SRL, self-regulation');
    expect(result).toContain('**Maturity**: working');
  });

  it('appends excluded concept names when provided', () => {
    const concept: ConceptForFormat = {
      id: 'c-1', nameEn: 'A', nameZh: 'A', definition: 'def',
      searchKeywords: [], maturity: 'working',
    };
    const result = formatConceptFramework([concept], ['Concept B', 'Concept C']);
    expect(result).toContain('Other concepts in framework');
    expect(result).toContain('Concept B, Concept C');
  });
});

// ─── formatRagPassages ───

describe('formatRagPassages', () => {
  it('returns empty string for no passages', () => {
    expect(formatRagPassages([])).toBe('');
  });

  it('groups passages by paper', () => {
    const passages: RagPassageForFormat[] = [
      { paperId: 'p1', paperTitle: 'Paper A', chunkId: 'ch1', text: 'chunk 1', score: 0.9 },
      { paperId: 'p1', paperTitle: 'Paper A', chunkId: 'ch2', text: 'chunk 2', score: 0.7 },
      { paperId: 'p2', paperTitle: 'Paper B', chunkId: 'ch3', text: 'chunk 3', score: 0.8 },
    ];
    const result = formatRagPassages(passages);
    expect(result).toContain('From: Paper A (p1)');
    expect(result).toContain('From: Paper B (p2)');
  });

  it('includes score in formatted output', () => {
    const passages: RagPassageForFormat[] = [
      { paperId: 'p1', chunkId: 'ch1', text: 'text', score: 0.85 },
    ];
    const result = formatRagPassages(passages);
    expect(result).toContain('score: 0.850');
  });
});

// ─── formatAdjudicationHistory ───

describe('formatAdjudicationHistory', () => {
  it('returns empty string for no entries', () => {
    expect(formatAdjudicationHistory('Concept A', [])).toBe('');
  });

  it('groups by decision type', () => {
    const entries: AdjudicationForFormat[] = [
      {
        paperId: 'p1', paperTitle: 'Paper 1', paperYear: 2024,
        relation: 'supports', confidence: 0.8,
        decision: 'accepted', decisionNote: null,
      },
      {
        paperId: 'p2', paperTitle: 'Paper 2', paperYear: 2023,
        relation: 'contradicts', confidence: 0.6,
        decision: 'rejected', decisionNote: 'Incorrect mapping',
      },
      {
        paperId: 'p3', paperTitle: 'Paper 3', paperYear: 2024,
        relation: 'supports', confidence: 0.5,
        decision: 'revised', decisionNote: 'Better as extends',
        revisedRelation: 'extends', revisedConfidence: 0.7,
      },
    ];
    const result = formatAdjudicationHistory('Test', entries);
    expect(result).toContain('Accepted mappings');
    expect(result).toContain('Rejected mappings');
    expect(result).toContain('Revised mappings');
    expect(result).toContain('1 accepted, 1 revised, 1 rejected out of 3');
  });

  it('includes decision notes and revision details', () => {
    const entries: AdjudicationForFormat[] = [{
      paperId: 'p1', paperTitle: 'P1', paperYear: 2024,
      relation: 'supports', confidence: 0.5,
      decision: 'revised', decisionNote: 'Should be extends',
      revisedRelation: 'extends', revisedConfidence: 0.9,
    }];
    const result = formatAdjudicationHistory('C', entries);
    expect(result).toContain('"supports" → Researcher revised to "extends"');
    expect(result).toContain('Should be extends');
  });
});

// ─── formatEvidenceGaps ───

describe('formatEvidenceGaps', () => {
  it('returns empty string for no gaps', () => {
    expect(formatEvidenceGaps('Concept', [])).toBe('');
  });

  it('lists evidence gaps', () => {
    const result = formatEvidenceGaps('Agency', ['developmental origins', 'cross-cultural validity']);
    expect(result).toContain('concept "Agency"');
    expect(result).toContain('- developmental origins');
    expect(result).toContain('- cross-cultural validity');
    expect(result).toContain('fabricate evidence');
  });
});

// ─── formatProtectedParagraphs ───

describe('formatProtectedParagraphs', () => {
  it('returns empty string for no edited indices', () => {
    expect(formatProtectedParagraphs('Some content', [])).toBe('');
  });

  it('extracts and formats protected paragraphs', () => {
    const content = 'Para 0\n\nPara 1\n\nPara 2\n\nPara 3';
    const result = formatProtectedParagraphs(content, [1, 3]);
    expect(result).toContain('Paragraph 1');
    expect(result).toContain('Para 1');
    expect(result).toContain('Paragraph 3');
    expect(result).toContain('Para 3');
    expect(result).toContain('MUST preserve');
  });

  it('skips out-of-range indices', () => {
    const content = 'Para 0\n\nPara 1';
    const result = formatProtectedParagraphs(content, [0, 99]);
    expect(result).toContain('Para 0');
    expect(result).not.toContain('Paragraph 99');
  });
});
