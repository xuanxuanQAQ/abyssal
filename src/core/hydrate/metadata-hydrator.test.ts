import { describe, expect, it } from 'vitest';

import { hydratePaperMetadata, pickBestTitleSearchResult, scoreTitleSearchCandidate } from './metadata-hydrator';
import type { Logger } from '../infra/logger';
import type { PaperMetadata } from '../types/paper';

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function makePaper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    id: 'paper-1' as PaperMetadata['id'],
    title: '面向学术知识图谱的文献处理流水线设计',
    authors: ['张三', '李四'],
    year: 2024,
    doi: null,
    arxivId: null,
    venue: null,
    journal: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    isbn: null,
    edition: null,
    editors: null,
    bookTitle: null,
    series: null,
    issn: null,
    pmid: null,
    pmcid: null,
    url: null,
    abstract: null,
    citationCount: null,
    paperType: 'unknown',
    source: 'manual',
    bibtexKey: null,
    biblioComplete: false,
    ...overrides,
  };
}

describe('scoreTitleSearchCandidate', () => {
  it('accepts high-similarity title candidates', () => {
    const score = scoreTitleSearchCandidate(
      { title: 'Graph-based Literature Processing Pipeline', authors: ['Alice Smith'], year: 2024 },
      { title: 'Graph Based Literature Processing Pipeline', authors: ['Alice Smith'], year: 2024 },
    );

    expect(score.accepted).toBe(true);
    expect(score.titleScore).toBeGreaterThan(0.9);
  });

  it('rejects low-similarity title candidates', () => {
    const score = scoreTitleSearchCandidate(
      { title: 'Graph-based Literature Processing Pipeline', authors: ['Alice Smith'], year: 2024 },
      { title: 'Clinical Outcomes of Liver Surgery', authors: ['Bob Jones'], year: 2018 },
    );

    expect(score.accepted).toBe(false);
    expect(score.titleScore).toBeLessThan(0.3);
  });
});

describe('pickBestTitleSearchResult', () => {
  it('selects the best matching candidate instead of the first result', () => {
    const best = pickBestTitleSearchResult(
      {
        title: '面向学术知识图谱的文献处理流水线设计',
        authors: ['张三', '李四'],
        year: 2024,
      },
      [
        { title: '医疗知识图谱在肝病治疗中的应用', authors: ['王五'], year: 2021, doi: '10.1000/wrong' },
        { title: '面向学术知识图谱的文献处理流水线设计', authors: ['张三', '李四'], year: 2024, doi: '10.1000/right' },
      ],
    );

    expect(best?.candidate.doi).toBe('10.1000/right');
  });
});

describe('hydratePaperMetadata', () => {
  it('fills fields only from validated title-search matches', async () => {
    const paper = makePaper();
    const result = await hydratePaperMetadata(
      paper,
      null,
      null,
      {
        llmCall: null,
        lookupService: {
          searchByTitle: async () => [
            { title: '完全不相关的文章标题', authors: ['陌生作者'], year: 2020, doi: '10.1000/wrong' },
            { title: '面向学术知识图谱的文献处理流水线设计', authors: ['张三', '李四'], year: 2024, doi: '10.1000/right' },
          ],
        },
        enrichService: null,
        config: { enableApiLookup: true, enableLlmExtraction: false },
        logger,
      },
    );

    expect(result.patch.doi).toBe('10.1000/right');
  });

  it('does not hydrate from weak title-only matches', async () => {
    const paper = makePaper({ title: '图谱驱动的文献组织方法' });
    const result = await hydratePaperMetadata(
      paper,
      null,
      null,
      {
        llmCall: null,
        lookupService: {
          searchByTitle: async () => [
            { title: '医学影像驱动的辅助诊断方法', authors: ['陌生作者'], year: 2019, doi: '10.1000/wrong' },
          ],
        },
        enrichService: null,
        config: { enableApiLookup: true, enableLlmExtraction: false },
        logger,
      },
    );

    expect(result.patch.doi).toBeUndefined();
    expect(result.result.fieldsUpdated.some((field) => field.field === 'doi')).toBe(false);
  });
});