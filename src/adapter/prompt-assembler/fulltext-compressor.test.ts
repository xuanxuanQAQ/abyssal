import { compressFulltext, extractFirstSentence, type SectionMapEntry } from './fulltext-compressor';

const counter = { count: (text: string) => Math.ceil(text.length / 4) };

// ─── compressFulltext ───

describe('compressFulltext', () => {
  it('returns content unchanged when under budget (no sectionMap)', () => {
    const result = compressFulltext('Short text.', null, 1000, counter);
    expect(result).toBe('Short text.');
  });

  it('falls back to simple truncation when no sectionMap', () => {
    const text = 'x'.repeat(8000);
    const result = compressFulltext(text, null, 100, counter);
    expect(counter.count(result)).toBeLessThanOrEqual(200); // reasonable truncation
    expect(result).toContain('<abyssal:omitted');
  });

  it('preserves abstract and conclusion', () => {
    const text = [
      'This is the abstract content.',
      'Introduction body text here. '.repeat(20),
      'This is the conclusion.',
    ].join('\n\n');

    const sectionMap: SectionMapEntry[] = [
      { sectionType: 'abstract', title: 'Abstract', startOffset: 0, endOffset: 29 },
      { sectionType: 'introduction', title: 'Introduction', startOffset: 31, endOffset: 31 + 'Introduction body text here. '.repeat(20).length },
      { sectionType: 'conclusion', title: 'Conclusion', startOffset: text.lastIndexOf('This is the conclusion.'), endOffset: text.length },
    ];

    const result = compressFulltext(text, sectionMap, 80, counter);
    expect(result).toContain('This is the abstract content.');
    expect(result).toContain('This is the conclusion.');
  });

  it('compresses body sections when over budget', () => {
    const abstractText = 'Abstract content.';
    const bodyText = 'Body paragraph 1.\n\nBody paragraph 2.\n\nBody paragraph 3.\n\nBody final.';
    const conclusionText = 'Conclusion here.';
    const text = `${abstractText}\n\n${bodyText}\n\n${conclusionText}`;

    const absEnd = abstractText.length;
    const bodyStart = absEnd + 2;
    const bodyEnd = bodyStart + bodyText.length;
    const concStart = bodyEnd + 2;

    const sectionMap: SectionMapEntry[] = [
      { sectionType: 'abstract', title: 'Abstract', startOffset: 0, endOffset: absEnd },
      { sectionType: 'introduction', title: 'Introduction', startOffset: bodyStart, endOffset: bodyEnd },
      { sectionType: 'conclusion', title: 'Conclusion', startOffset: concStart, endOffset: text.length },
    ];

    // Very tight budget → body should be compressed
    const result = compressFulltext(text, sectionMap, 30, counter);
    expect(result).toContain('Abstract content.');
  });

  it('uses discussion last subsection as conclusion fallback', () => {
    const text = 'Abstract here.\n\nIntro paragraph.\n\nDiscussion paragraph 1.\n\nDiscussion final thoughts.';
    const sectionMap: SectionMapEntry[] = [
      { sectionType: 'abstract', title: 'Abstract', startOffset: 0, endOffset: 14 },
      { sectionType: 'introduction', title: 'Intro', startOffset: 16, endOffset: 32 },
      { sectionType: 'discussion', title: 'Discussion', startOffset: 34, endOffset: text.length },
    ];
    const result = compressFulltext(text, sectionMap, 5000, counter);
    // Should include discussion content since no explicit conclusion
    expect(result).toContain('Discussion');
  });

  it('evidence-aware: retains statistical paragraphs in results section', () => {
    // Build a results section with statistical content
    const abstractText = 'Abstract.';
    const resultsText = [
      'Results overview paragraph.',
      'The main effect was significant (F(1,50) = 4.2, p < .05, η² = .08).',
      'Descriptive paragraph without numbers.',
      'Regression showed β = .45, p < .001, R² = .20.',
      'Final results summary.',
    ].join('\n\n');
    const text = `${abstractText}\n\n${resultsText}`;

    const sectionMap: SectionMapEntry[] = [
      { sectionType: 'abstract', title: 'Abstract', startOffset: 0, endOffset: abstractText.length },
      { sectionType: 'results', title: 'Results', startOffset: abstractText.length + 2, endOffset: text.length },
    ];

    const result = compressFulltext(text, sectionMap, 500, counter);
    // Statistical paragraphs should be retained
    expect(result).toContain('F(1,50)');
    expect(result).toContain('β = .45');
  });

  it('excludes references and appendix sections', () => {
    const text = 'Abstract.\n\nIntro text.\n\nReferences list.\n\nAppendix stuff.';
    const sectionMap: SectionMapEntry[] = [
      { sectionType: 'abstract', title: 'Abstract', startOffset: 0, endOffset: 9 },
      { sectionType: 'introduction', title: 'Intro', startOffset: 11, endOffset: 22 },
      { sectionType: 'references', title: 'References', startOffset: 24, endOffset: 40 },
      { sectionType: 'appendix', title: 'Appendix', startOffset: 42, endOffset: text.length },
    ];
    const result = compressFulltext(text, sectionMap, 5000, counter);
    // References and appendix text should not be in the compressed output
    expect(result).not.toContain('References list.');
    expect(result).not.toContain('Appendix stuff.');
  });
});

// ─── extractFirstSentence ───

describe('extractFirstSentence', () => {
  it('extracts up to the first period', () => {
    expect(extractFirstSentence('Hello world. More text.')).toBe('Hello world.');
  });

  it('handles exclamation marks', () => {
    expect(extractFirstSentence('Wow! Amazing.')).toBe('Wow!');
  });

  it('handles question marks', () => {
    expect(extractFirstSentence('Really? Yes.')).toBe('Really?');
  });

  it('falls back to first 200 chars if no sentence ending found', () => {
    const noEnd = 'a'.repeat(300);
    expect(extractFirstSentence(noEnd)).toHaveLength(200);
  });
});
