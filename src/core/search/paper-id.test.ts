import { isPaperId } from '../types/common';
import {
  titleNormalize,
  titleNormalizeTokenCount,
  generatePaperId,
  normalizeDoi,
  normalizeArxivId,
} from './paper-id';

// ═══ titleNormalize ═══

describe('titleNormalize', () => {
  it('lowercases, removes stop words, and joins in original order', () => {
    const result = titleNormalize('The Quick Brown Fox');
    // "the" removed (stop word), remaining in order: quick, brown, fox
    expect(result).toBe('quickbrownfox');
  });

  it('removes stop words', () => {
    const result = titleNormalize('A Study of the Impact on Learning');
    // stop words: a, of, the, on → remaining in order: study, impact, learning
    expect(result).toBe('studyimpactlearning');
  });

  it('strips punctuation and symbols', () => {
    const result = titleNormalize('Hello, World! (2024) — Results & Analysis');
    // punctuation/symbols removed, in order: hello world 2024 results analysis
    expect(result).toBe('helloworld2024resultsanalysis');
  });

  it('preserves CJK characters', () => {
    const result = titleNormalize('深度学习 in NLP');
    // "in" is a stop word → removed; remaining in order: 深度学习, nlp
    expect(result).toBe('深度学习nlp');
  });

  it('returns empty string for empty input', () => {
    expect(titleNormalize('')).toBe('');
  });

  it('returns empty string when input is only stop words', () => {
    expect(titleNormalize('the a an of')).toBe('');
  });

  // Fix #4: 不同词序的标题不再被视为相同
  it('distinguishes titles with different word order', () => {
    const a = titleNormalize('Deep Learning for NLP');
    const b = titleNormalize('NLP for Deep Learning');
    expect(a).not.toBe(b);
  });

  // Fix: 零宽字符清理
  it('strips zero-width characters', () => {
    const withZeroWidth = 'Hello\u200bWorld\u200cTest';
    const clean = 'HelloWorldTest';
    expect(titleNormalize(withZeroWidth)).toBe(titleNormalize(clean));
  });
});

// ═══ titleNormalizeTokenCount ═══

describe('titleNormalizeTokenCount', () => {
  it('counts content words correctly', () => {
    expect(titleNormalizeTokenCount('The Quick Brown Fox')).toBe(3);
  });

  it('returns 0 for only stop words', () => {
    expect(titleNormalizeTokenCount('the a an of')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(titleNormalizeTokenCount('')).toBe(0);
  });

  it('counts CJK tokens (unsplit) as single token', () => {
    // CJK without spaces is treated as one token
    expect(titleNormalizeTokenCount('深度学习方法')).toBe(1);
  });

  it('counts mixed CJK + English tokens', () => {
    // "深度学习" (1 token) + "in" (stop word, removed) + "NLP" (1 token)
    expect(titleNormalizeTokenCount('深度学习 in NLP')).toBe(2);
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

  // Fix #8: fallback identifier support
  it('uses fallback identifier when DOI, arXiv, and title are absent', () => {
    const id = generatePaperId(null, null, null, 'https://example.com/paper.pdf');
    expect(id).toHaveLength(12);
    expect(isPaperId(id)).toBe(true);
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

  // Fix #2: 零宽字符清理
  it('strips zero-width characters from DOI', () => {
    expect(normalizeDoi('10.1234\u200b/abc')).toBe('10.1234/abc');
  });

  // Fix #2: 双重 URL 编码
  it('handles double URL encoding (%252F)', () => {
    expect(normalizeDoi('10.1234%252Fabc')).toBe('10.1234/abc');
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

  // Fix #3: arXiv: prefix
  it('strips arXiv: prefix', () => {
    expect(normalizeArxivId('arXiv:2301.12345')).toBe('2301.12345');
  });

  // Fix #3: PDF URL format
  it('strips https://arxiv.org/pdf/ prefix and .pdf suffix', () => {
    expect(normalizeArxivId('https://arxiv.org/pdf/2301.12345v2.pdf')).toBe(
      '2301.12345',
    );
  });

  // Fix: 零宽字符清理
  it('strips zero-width characters', () => {
    expect(normalizeArxivId('2301\u200b.12345')).toBe('2301.12345');
  });

  // 旧格式 arXiv ID
  it('handles old format arXiv IDs (hep-ph/9905221)', () => {
    expect(normalizeArxivId('hep-ph/9905221v2')).toBe('hep-ph/9905221');
  });
});
