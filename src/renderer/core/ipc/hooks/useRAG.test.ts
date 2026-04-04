import { describe, expect, it } from 'vitest';
import { buildWritingContextQueryKey } from './useRAG';

describe('buildWritingContextQueryKey', () => {
  it('uses article, draft, section and mode to build a stable key', () => {
    expect(buildWritingContextQueryKey({
      articleId: 'article-1',
      draftId: 'draft-1',
      sectionId: 'section-1',
      mode: 'draft',
    })).toEqual(['rag', 'writingContext', 'article-1', 'draft-1', 'section-1', 'draft']);
  });

  it('falls back to empty placeholders for missing fields', () => {
    expect(buildWritingContextQueryKey(null)).toEqual(['rag', 'writingContext', '', '', '', 'local']);
  });
});