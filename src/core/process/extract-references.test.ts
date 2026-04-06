import { describe, expect, it } from 'vitest';

import { extractReferences } from './extract-references';

describe('extractReferences', () => {
  it('detects stacked Chinese references heading', () => {
    const text = [
      '正文第一段',
      '参',
      '考',
      '文',
      '献',
      '[1] 张三. 碳市场研究[J]. 经济研究, 2020, 12: 1-10.',
      '[2] Li H. Power Market Risk[J]. Energy, 2021, 30: 20-30.',
    ].join('\n');

    const refs = extractReferences(text);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.year).toBe(2020);
    expect(refs[1]?.year).toBe(2021);
  });
});