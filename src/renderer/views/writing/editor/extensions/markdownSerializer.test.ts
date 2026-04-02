import { getSchema } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
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
});