import { getSchema } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { mathExtension } from './mathExtension';
import { parseFromMarkdown } from './markdownSerializer';

function createNoteSchema() {
  return getSchema([
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    Highlight,
    Subscript,
    Superscript,
    ...mathExtension,
  ]);
}

describe('parseFromMarkdown', () => {
  it('parses paragraph text nodes without calling NodeType.create on text', () => {
    const schema = createNoteSchema();

    const doc = parseFromMarkdown('plain **bold** text', schema);

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' text' },
          ],
        },
      ],
    });
  });

  it('parses code block text content into a valid ProseMirror document', () => {
    const schema = createNoteSchema();

    const doc = parseFromMarkdown('```ts\nconst x = 1;\n```', schema);

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    });
  });

  it('parses empty code block without creating empty text nodes', () => {
    const schema = createNoteSchema();

    const doc = parseFromMarkdown('```\n```', schema);

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: '' },
        },
      ],
    });
  });

  it('parses inline math into mathInline nodes when schema supports math', () => {
    const schema = createNoteSchema();

    const doc = parseFromMarkdown('公式：$E = mc^2$', schema);

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '公式：' },
            { type: 'mathInline', attrs: { latex: 'E = mc^2' } },
          ],
        },
      ],
    });
  });

  it('parses math block into mathBlock nodes when schema supports math', () => {
    const schema = createNoteSchema();

    const doc = parseFromMarkdown('$$\n\\int_a^b f(x) \\, dx\n$$', schema);

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'mathBlock',
          attrs: { latex: '\\int_a^b f(x) \\, dx' },
        },
      ],
    });
  });
});