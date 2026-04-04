/**
 * sectionExtension — Custom ProseMirror node for document sections.
 *
 * Schema: doc > section+
 * Each section wraps a heading (title) followed by body content.
 * The sectionId attribute links back to the outline entry.
 *
 * This enables:
 * - Cross-section operations (find/replace, cross-references)
 * - Single editor instance for the full document
 * - Natural scroll-to-section navigation
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface SectionAttributes {
  sectionId: string;
  level: number;
}

export const sectionExtension = Node.create({
  name: 'section',

  group: 'block',

  content: 'block+',

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      sectionId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-section-id') ?? '',
        renderHTML: (attributes) => ({
          'data-section-id': attributes.sectionId as string,
        }),
      },
      level: {
        default: 1,
        parseHTML: (element) =>
          parseInt(element.getAttribute('data-section-level') ?? '1', 10),
        renderHTML: (attributes) => ({
          'data-section-level': String(attributes.level),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-section-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        class: 'tiptap-section',
        style: 'margin-bottom: 24px; padding-bottom: 16px;',
      }),
      0,
    ];
  },
});
