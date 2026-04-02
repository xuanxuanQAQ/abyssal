/**
 * crossRefExtension — Inline cross-reference node for figures, tables, equations, sections.
 *
 * Usage in editor: {{ref:fig:methodology}} renders as "Figure 1"
 * Export: LaTeX → \ref{fig:methodology}, Markdown → Figure 1
 *
 * The label registry is maintained at the document level and
 * resolves display numbers at render time.
 */

import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossRef: {
      insertCrossRef: (label: string, refType: string) => ReturnType;
    };
  }
}

export const crossRefExtension = Node.create({
  name: 'crossRef',

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-ref-label') ?? '',
      },
      refType: {
        default: 'figure',
        parseHTML: (el) => el.getAttribute('data-ref-type') ?? 'figure',
      },
      displayText: {
        default: '',
        parseHTML: (el) => el.textContent ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-cross-ref]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const refType = HTMLAttributes.refType as string;
    const label = HTMLAttributes.label as string;
    const displayText =
      (HTMLAttributes.displayText as string) ||
      `${refTypePrefix(refType)} ??`;

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-cross-ref': 'true',
        'data-ref-label': label,
        'data-ref-type': refType,
        class: 'tiptap-cross-ref',
        style:
          'color: var(--accent-color); cursor: pointer; text-decoration: underline; text-decoration-style: dotted;',
        title: `Reference: ${label}`,
      }),
      displayText,
    ];
  },

  addCommands() {
    return {
      insertCrossRef:
        (label: string, refType: string) =>
        ({ chain }: CommandProps) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: {
                label,
                refType,
                displayText: `${refTypePrefix(refType)} ??`,
              },
            })
            .run();
        },
    };
  },
});

function refTypePrefix(refType: string): string {
  switch (refType) {
    case 'figure':
      return 'Figure';
    case 'table':
      return 'Table';
    case 'equation':
      return 'Eq.';
    case 'section':
      return 'Section';
    default:
      return 'Ref.';
  }
}
