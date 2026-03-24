/**
 * MathInline and MathBlock nodes with KaTeX rendering.
 *
 * - MathInline: triggered by `$...$`, atom node, inline
 * - MathBlock: triggered by `$$` on new line, block level
 * - Both render using KaTeX.renderToString
 * - Error handling: show red error text on invalid LaTeX
 */

import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import katex from 'katex';

// ─── Shared KaTeX renderer ───

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#f38ba8',
      strict: false,
      trust: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid LaTeX';
    return `<span style="color: #f38ba8; font-family: monospace; font-size: 12px;">${escapeHtml(message)}</span>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── MathInline ───

const MATH_INLINE_INPUT_REGEX = /\$([^$\n]+)\$$/;

export const mathInlineNode = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex') ?? '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'math-inline',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            latex: element.getAttribute('data-latex') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = (HTMLAttributes.latex as string) ?? '';
    const rendered = renderKatex(latex, false);
    return [
      'math-inline',
      mergeAttributes(
        {
          'data-latex': latex,
          style: 'display: inline; cursor: pointer;',
          class: 'math-inline-node',
        },
        { contenteditable: 'false' },
      ),
      ['span', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('math-inline');
      const latex = (node.attrs.latex as string) ?? '';
      dom.setAttribute('data-latex', latex);
      dom.style.display = 'inline';
      dom.style.cursor = 'pointer';
      dom.contentEditable = 'false';
      dom.innerHTML = renderKatex(latex, false);
      return { dom };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: MATH_INLINE_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const latex = match[1] ?? '';
          const nodeType = state.schema.nodes.mathInline;
          if (!nodeType) return;
          const node = nodeType.create({ latex });
          const tr = state.tr.replaceWith(range.from, range.to, node);
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(range.from + node.nodeSize)),
          );
        },
      }),
    ];
  },
});

// ─── MathBlock ───

const MATH_BLOCK_INPUT_REGEX = /^\$\$$/;

export const mathBlockNode = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex') ?? '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'math-block',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            latex: element.getAttribute('data-latex') ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const latex = (HTMLAttributes.latex as string) ?? '';
    const rendered = renderKatex(latex, true);
    return [
      'math-block',
      mergeAttributes(
        {
          'data-latex': latex,
          style: 'display: block; text-align: center; margin: 16px 0; cursor: pointer;',
          class: 'math-block-node',
        },
        { contenteditable: 'false' },
      ),
      ['div', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('math-block');
      const latex = (node.attrs.latex as string) ?? '';
      dom.setAttribute('data-latex', latex);
      dom.style.display = 'block';
      dom.style.textAlign = 'center';
      dom.style.margin = '16px 0';
      dom.style.cursor = 'pointer';
      dom.contentEditable = 'false';
      dom.innerHTML = renderKatex(latex, true);
      return { dom };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: MATH_BLOCK_INPUT_REGEX,
        handler: ({ state, range }) => {
          const nodeType = state.schema.nodes.mathBlock;
          if (!nodeType) return;
          const node = nodeType.create({ latex: '' });
          const tr = state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});

// ─── Combined export ───

export const mathExtension = [mathInlineNode, mathBlockNode];
