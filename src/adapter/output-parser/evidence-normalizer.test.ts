import { normalizeEvidence, detectLanguage } from './evidence-normalizer';

describe('normalizeEvidence', () => {
  // Case 1: null/undefined
  it('returns empty structure for null', () => {
    const r = normalizeEvidence(null);
    expect(r.en).toBe('');
    expect(r.original).toBe('');
    expect(r.original_lang).toBe('unknown');
    expect(r.chunk_id).toBeNull();
    expect(r.page).toBeNull();
    expect(r.annotation_id).toBeNull();
  });

  it('returns empty structure for undefined', () => {
    const r = normalizeEvidence(undefined);
    expect(r.en).toBe('');
    expect(r.original_lang).toBe('unknown');
  });

  // Case 2: plain string
  it('detects English from plain string', () => {
    const r = normalizeEvidence('The paper argues that affordances are key');
    expect(r.en).toBe('The paper argues that affordances are key');
    expect(r.original).toBe('The paper argues that affordances are key');
    expect(r.original_lang).toBe('en');
  });

  it('detects Chinese from plain string', () => {
    const r = normalizeEvidence('这篇论文论述了可供性的概念在交互设计中的重要作用');
    expect(r.original_lang).toBe('zh-CN');
  });

  it('trims whitespace from string input', () => {
    const r = normalizeEvidence('  hello world  ');
    expect(r.en).toBe('hello world');
  });

  // Case 3: structured object
  it('resolves fields from structured object', () => {
    const r = normalizeEvidence({
      en: 'English evidence',
      original: '中文证据',
      original_lang: 'zh-CN',
      chunk_id: 'c1',
      page: 5,
      annotation_id: 'a1',
    });
    expect(r.en).toBe('English evidence');
    expect(r.original).toBe('中文证据');
    expect(r.original_lang).toBe('zh-CN');
    expect(r.chunk_id).toBe('c1');
    expect(r.page).toBe(5);
    expect(r.annotation_id).toBe('a1');
  });

  it('uses alternate field names (english, source, lang)', () => {
    const r = normalizeEvidence({ english: 'alt en', source: 'alt orig', lang: 'ja' });
    expect(r.en).toBe('alt en');
    expect(r.original).toBe('alt orig');
    expect(r.original_lang).toBe('ja');
  });

  it('uses camelCase field names (originalLang, chunkId, annotationId)', () => {
    const r = normalizeEvidence({ text: 'hello', originalLang: 'ko', chunkId: 'c2', annotationId: 'a2' });
    expect(r.original_lang).toBe('ko');
    expect(r.chunk_id).toBe('c2');
    expect(r.annotation_id).toBe('a2');
  });

  it('backfills en from original when en is empty', () => {
    const r = normalizeEvidence({ original: 'only original' });
    expect(r.en).toBe('only original');
  });

  it('backfills original from en when original is empty', () => {
    const r = normalizeEvidence({ en: 'only en' });
    expect(r.original).toBe('only en');
  });

  it('auto-detects language when not provided', () => {
    const r = normalizeEvidence({ text: '这是一段中文文本测试' });
    expect(r.original_lang).toBe('zh-CN');
  });

  it('parses page from string', () => {
    const r = normalizeEvidence({ text: 'foo', page: '42' });
    expect(r.page).toBe(42);
  });

  it('returns null for invalid page', () => {
    const r = normalizeEvidence({ text: 'foo', page: 'abc' });
    expect(r.page).toBeNull();
  });

  // Case 4: other types
  it('stringifies array input', () => {
    const r = normalizeEvidence([1, 2, 3]);
    expect(r.en).toBe('1,2,3');
    expect(r.original_lang).toBe('unknown');
  });

  it('stringifies number input', () => {
    const r = normalizeEvidence(42);
    expect(r.en).toBe('42');
  });

  it('stringifies boolean input', () => {
    const r = normalizeEvidence(true);
    expect(r.en).toBe('true');
  });
});

describe('detectLanguage', () => {
  it('returns "unknown" for empty string', () => {
    expect(detectLanguage('')).toBe('unknown');
  });

  it('returns "en" for English text', () => {
    expect(detectLanguage('The paper discusses theoretical frameworks')).toBe('en');
  });

  it('returns "zh-CN" for Chinese text', () => {
    expect(detectLanguage('这篇论文讨论了理论框架的构建方法')).toBe('zh-CN');
  });

  it('returns "ja" for Japanese text', () => {
    expect(detectLanguage('この論文はアフォーダンスの概念を議論している')).toBe('ja');
  });

  it('returns "ko" for Korean text', () => {
    expect(detectLanguage('이 논문은 어포던스 개념을 논의하고 있습니다')).toBe('ko');
  });

  it('detects CJK by ratio > 30%', () => {
    // 6 CJK chars out of 12 total = 50%
    expect(detectLanguage('测试abc测试abc测试')).toBe('zh-CN');
  });
});
