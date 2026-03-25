import { isPaperId } from '../types/common';
import {
  titleNormalize,
  generatePaperId,
  normalizeDoi,
  normalizeArxivId,
} from './paper-id';

// ═══ titleNormalize ═══

describe('titleNormalize', () => {
  it('lowercases, removes stop words, sorts tokens, and joins', () => {
    const result = titleNormalize('The Quick Brown Fox');
    // "the" removed (stop word), remaining: quick, brown, fox → sorted → brownfoxquick
    expect(result).toBe('brownfoxquick');
  });

  it('removes stop words', () => {
    const result = titleNormalize('A Study of the Impact on Learning');
    // stop words: a, of, the, on → remaining: study, impact, learning → sorted
    expect(result).toBe('impactlearningstudy');
  });

  it('strips punctuation and symbols', () => {
    const result = titleNormalize('Hello, World! (2024) — Results & Analysis');
    // punctuation/symbols removed: hello world 2024 results analysis → sorted
    expect(result).toBe('2024analysishelloresultsworld');
  });

  it('preserves CJK characters', () => {
    const result = titleNormalize('深度学习 in NLP');
    // "in" is a stop word → removed; remaining tokens: 深度学习, nlp → sorted
    expect(result).toBe('nlp深度学习');
  });

  it('returns empty string for empty input', () => {
    expect(titleNormalize('')).toBe('');
  });

  it('returns empty string when input is only stop words', () => {
    expect(titleNormalize('the a an of')).toBe('');
  });
});

// ═══ generatePaperId ═══

describe('generatePaperId', () => {
  it('generates a valid 12-char hex PaperId from DOI', () => {
    const id = generatePaperId('10.1234/test', null, null);
    expect(id).toHaveLength(12);
    expect(isPaperId(id)).toBe(true);
  });

  it('generates a valid PaperId from arXiv ID when DOI is absent', () => {
    const id = generatePaperId(null, '2301.12345', null);
    expect(id).toHaveLength(12);
    expect(isPaperId(id)).toBe(true);
  });

  it('generates a valid PaperId from title when DOI and arXiv are absent', () => {
    const id = generatePaperId(null, null, 'Some Paper Title');
    expect(id).toHaveLength(12);
    expect(isPaperId(id)).toBe(true);
  });

  it('throws when all inputs are null', () => {
    expect(() => generatePaperId(null, null, null)).toThrow(
      'Cannot generate PaperId',
    );
  });

  it('prioritises DOI over arXiv and title', () => {
    const fromDoi = generatePaperId('10.1234/test', '2301.12345', 'Title');
    const fromDoiOnly = generatePaperId('10.1234/test', null, null);
    expect(fromDoi).toBe(fromDoiOnly);
  });

  it('prioritises arXiv over title when DOI is absent', () => {
    const fromArxiv = generatePaperId(null, '2301.12345', 'Title');
    const fromArxivOnly = generatePaperId(null, '2301.12345', null);
    expect(fromArxiv).toBe(fromArxivOnly);
  });

  it('is deterministic — same input produces the same output', () => {
    const a = generatePaperId('10.1000/xyz', null, null);
    const b = generatePaperId('10.1000/xyz', null, null);
    expect(a).toBe(b);
  });
});

// ═══ normalizeDoi ═══

describe('normalizeDoi', () => {
  it('returns a plain DOI lowercased', () => {
    expect(normalizeDoi('10.1234/ABC')).toBe('10.1234/abc');
  });

  it('strips https://doi.org/ prefix', () => {
    expect(normalizeDoi('https://doi.org/10.1234/abc')).toBe('10.1234/abc');
  });

  it('strips http://dx.doi.org/ prefix', () => {
    expect(normalizeDoi('http://dx.doi.org/10.1234/abc')).toBe('10.1234/abc');
  });

  it('decodes percent-encoded characters (%2F)', () => {
    expect(normalizeDoi('10.1234%2Fabc')).toBe('10.1234/abc');
  });

  it('trims trailing dots and whitespace', () => {
    expect(normalizeDoi('10.1234/abc.. ')).toBe('10.1234/abc');
  });

  it('handles URL prefix combined with encoding and trailing dots', () => {
    expect(normalizeDoi('https://doi.org/10.1234%2FABC.')).toBe('10.1234/abc');
  });
});

// ═══ normalizeArxivId ═══

describe('normalizeArxivId', () => {
  it('returns a plain arXiv ID unchanged', () => {
    expect(normalizeArxivId('2301.12345')).toBe('2301.12345');
  });

  it('strips https://arxiv.org/abs/ prefix', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/2301.12345')).toBe(
      '2301.12345',
    );
  });

  it('strips http://arxiv.org/abs/ prefix', () => {
    expect(normalizeArxivId('http://arxiv.org/abs/2301.12345')).toBe(
      '2301.12345',
    );
  });

  it('removes version suffix', () => {
    expect(normalizeArxivId('2301.12345v3')).toBe('2301.12345');
  });

  it('removes version suffix from a URL-prefixed ID', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/2301.12345v2')).toBe(
      '2301.12345',
    );
  });
});
