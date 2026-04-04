import { formatAnnotations, type AnnotationForInjection } from './annotation-injector';

const counter = { count: (text: string) => Math.ceil(text.length / 4) };

describe('formatAnnotations', () => {
  it('returns null block for empty array', () => {
    const result = formatAnnotations([], counter);
    expect(result).toEqual({ block: null, tokens: 0, count: 0 });
  });

  it('formats a single highlight with page number', () => {
    const ann: AnnotationForInjection = { page: 3, type: 'highlight', text: 'important finding' };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('⭐ [Page 3] highlight');
    expect(result.block).toContain('Text: "important finding"');
    expect(result.count).toBe(1);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it('shows "Page ?" when page is undefined', () => {
    const ann: AnnotationForInjection = { text: 'some text' };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('[Page ?]');
  });

  it('defaults type to highlight when missing', () => {
    const ann: AnnotationForInjection = { text: 'text' };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('] highlight');
  });

  it('truncates text longer than 300 chars', () => {
    const longText = 'a'.repeat(400);
    const ann: AnnotationForInjection = { text: longText, page: 1 };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('a'.repeat(300) + '...');
    expect(result.block).not.toContain('a'.repeat(301));
  });

  it('includes comment when present', () => {
    const ann: AnnotationForInjection = { text: 'text', comment: 'my note' };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('Note: "my note"');
  });

  it('includes concept link when conceptId is present', () => {
    const ann: AnnotationForInjection = {
      text: 'text',
      conceptId: 'c-1',
      conceptName: 'Self-Regulation',
    };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('Concept: Self-Regulation');
  });

  it('uses conceptId as label when conceptName is missing', () => {
    const ann: AnnotationForInjection = { text: 'text', conceptId: 'c-1' };
    const result = formatAnnotations([ann], counter);
    expect(result.block).toContain('Concept: c-1');
  });

  it('formats multiple annotations with correct count', () => {
    const anns: AnnotationForInjection[] = [
      { text: 'first', page: 1 },
      { text: 'second', page: 2 },
      { text: 'third', page: 3 },
    ];
    const result = formatAnnotations(anns, counter);
    expect(result.count).toBe(3);
    expect(result.block).toContain("## Researcher's Annotations");
  });

  it('does not include Note line when comment is absent', () => {
    const ann: AnnotationForInjection = { text: 'text', page: 1 };
    const result = formatAnnotations([ann], counter);
    expect(result.block).not.toContain('Note:');
  });
});
