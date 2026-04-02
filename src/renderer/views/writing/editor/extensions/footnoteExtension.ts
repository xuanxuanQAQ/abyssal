/**
 * footnoteExtension — Inline footnote node for academic writing.
 *
 * Usage: Insert a footnote inline; it renders as a superscript number.
 * The footnote content is stored in the `content` attribute.
 * Export serializes to \footnote{} in LaTeX or [^N] in Markdown.
 */

import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content: string) => ReturnType;
    };
  }
}

export const footnoteExtension = Node.create({
  name: 'footnote',

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-footnote-content') ?? '',
      },
      /** Auto-assigned number for display */
      number: {
        default: 0,
        parseHTML: (el) =>
          parseInt(el.getAttribute('data-footnote-number') ?? '0', 10),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-footnote]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const num = (HTMLAttributes.number as number) || '?';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': 'true',
        'data-footnote-content': HTMLAttributes.content,
        'data-footnote-number': String(num),
        class: 'tiptap-footnote',
        style:
          'cursor: pointer; color: var(--accent-color); font-size: 0.75em; vertical-align: super; font-weight: 600;',
        title: HTMLAttributes.content as string,
      }),
      String(num),
    ];
  },

  addCommands() {
    return {
      insertFootnote:
        (content: string) =>
        ({ chain, state }: CommandProps) => {
          // Count existing footnotes to determine number
          let count = 0;
          state.doc.descendants((node) => {
            if (node.type.name === 'footnote') count++;
          });

          return chain()
            .insertContent({
              type: this.name,
              attrs: { content, number: count + 1 },
            })
            .run();
        },
    };
  },
});
