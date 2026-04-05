/**
 * Golden tests — writing context, document outline projection.
 *
 * Freezes section projection, continuity context, and outline manipulation
 * so refactoring doesn't change document structure behavior.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDocumentProjection,
  parseArticleDocument,
  createEmptyArticleDocument,
  extractTextContent,
  extractPlainText,
  ensureOutlineHeadingIds,
  contentHash,
  createBodyDocumentFromText,
} from '../../../src/shared/writing/documentOutline';
import { makeArticleDocument } from '../../fixtures/workspace-scenarios';

const SAMPLE_DOC = makeArticleDocument([
  { id: 's1', title: '引言', body: '本文讨论可供性理论的发展历程。\n可供性概念最早由Gibson提出。' },
  { id: 's2', title: '方法', body: '我们采用系统综述方法。' },
  { id: 's3', title: '结果', body: '共收录30篇文献。\n其中15篇支持该理论。' },
]);

describe('document projection golden', () => {
  it('projects flat sections from structured document', () => {
    const projection = buildDocumentProjection(SAMPLE_DOC);
    expect(projection.flatSections.map((s) => ({
      id: s.id,
      title: s.title,
      level: s.level,
    }))).toMatchInlineSnapshot(`
      [
        {
          "id": "s1",
          "level": 1,
          "title": "引言",
        },
        {
          "id": "s2",
          "level": 1,
          "title": "方法",
        },
        {
          "id": "s3",
          "level": 1,
          "title": "结果",
        },
      ]
    `);
  });

  it('preserves word counts per section', () => {
    const projection = buildDocumentProjection(SAMPLE_DOC);
    const wordCounts = projection.flatSections.map((s) => ({
      id: s.id,
      wordCount: s.wordCount,
    }));
    for (const wc of wordCounts) {
      expect(wc.wordCount).toBeGreaterThan(0);
    }
  });

  it('extracts plain text per section body', () => {
    const projection = buildDocumentProjection(SAMPLE_DOC);
    const introSection = projection.flatSections.find((s) => s.id === 's1');
    expect(introSection?.plainText).toContain('可供性理论');
    expect(introSection?.plainText).toContain('Gibson');
  });

  it('builds body documents per section', () => {
    const projection = buildDocumentProjection(SAMPLE_DOC);
    for (const section of projection.flatSections) {
      expect(section.bodyDocument.type).toBe('doc');
      expect(Array.isArray(section.bodyDocument.content)).toBe(true);
    }
  });
});

describe('parseArticleDocument golden', () => {
  it('returns empty doc for null input', () => {
    const doc = parseArticleDocument(null);
    expect(doc).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "type": "paragraph",
          },
        ],
        "type": "doc",
      }
    `);
  });

  it('returns empty doc for invalid JSON', () => {
    const doc = parseArticleDocument('not valid json');
    expect(doc.type).toBe('doc');
  });

  it('returns empty doc for non-doc node', () => {
    const doc = parseArticleDocument('{"type":"paragraph"}');
    expect(doc.type).toBe('doc');
  });

  it('preserves valid document structure', () => {
    const json = JSON.stringify(SAMPLE_DOC);
    const doc = parseArticleDocument(json);
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(SAMPLE_DOC.content!.length);
  });
});

describe('ensureOutlineHeadingIds golden', () => {
  it('assigns IDs to headings without sectionId', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '第一章' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '1.1 小节' }] },
      ],
    };

    let idSeq = 0;
    const { document, changed } = ensureOutlineHeadingIds(doc, () => `auto-${++idSeq}`);

    expect(changed).toBe(true);
    const headings = document.content!.filter((n: any) => n.type === 'heading');
    expect(headings[0]!.attrs!.sectionId).toBe('auto-1');
    expect(headings[1]!.attrs!.sectionId).toBe('auto-2');
  });

  it('preserves existing sectionIds', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'heading', attrs: { level: 1, sectionId: 'existing-id' }, content: [{ type: 'text', text: '标题' }] },
      ],
    };

    const { document, changed } = ensureOutlineHeadingIds(doc, () => 'never-used');

    expect(changed).toBe(false);
    expect(document.content![0]!.attrs!.sectionId).toBe('existing-id');
  });
});

describe('utility functions golden', () => {
  it('extractTextContent from nested nodes', () => {
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
      ],
    };
    expect(extractTextContent(node)).toBe('Hello world');
  });

  it('createBodyDocumentFromText splits lines into paragraphs', () => {
    const doc = createBodyDocumentFromText('第一行\n第二行\n\n第三行');
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(3);
  });

  it('contentHash produces deterministic output', () => {
    const a = contentHash(SAMPLE_DOC);
    const b = contentHash(SAMPLE_DOC);
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('createEmptyArticleDocument has valid structure', () => {
    const doc = createEmptyArticleDocument();
    expect(doc).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "type": "paragraph",
          },
        ],
        "type": "doc",
      }
    `);
  });
});
