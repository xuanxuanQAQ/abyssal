/**
 * MathInline and MathBlock nodes with KaTeX rendering.
 *
 * - MathInline: triggered by `$...$`, atom node, inline
 * - MathBlock: triggered by `$$` on new line, block level
 * - Both render using KaTeX.renderToString
 * - Error handling: show red error text on invalid LaTeX
 */

import { Node as TiptapNode, mergeAttributes, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import katex from 'katex';

// ─── Shared KaTeX renderer ───

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#f38ba8',
      strict: false,
      trust: true,
    });
    return html;
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

export const mathInlineNode = TiptapNode.create({
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
          const latex = element.getAttribute('data-latex') ?? '';
          return { latex };
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
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('math-inline');
      dom.style.display = 'inline';
      dom.style.cursor = 'pointer';
      dom.contentEditable = 'false';
      dom.className = 'math-inline-node';

      const render = document.createElement('span');
      render.className = 'math-inline-render';
      dom.appendChild(render);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'math-inline-input';

      let isEditing = false;
      let draft = '';

      const getPosition = (): number | null => {
        if (typeof getPos === 'function') {
          const resolved = getPos();
          return typeof resolved === 'number' ? resolved : null;
        }
        return typeof getPos === 'number' ? getPos : null;
      };

      const commitLatex = (latex: string) => {
        const pos = getPosition();
        if (pos === null) return;
        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== 'mathInline') return;
        if ((currentNode.attrs.latex as string) === latex) return;

        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          latex,
        });
        editor.view.dispatch(tr);
      };

      const setRendered = (latex: string) => {
        dom.setAttribute('data-latex', latex);
        if (latex.trim().length === 0) {
          render.innerHTML = '<span class="math-inline-placeholder">公式</span>';
          return;
        }
        render.innerHTML = renderKatex(latex, false);
      };

      const startEditing = () => {
        if (isEditing) return;
        isEditing = true;
        dom.classList.add('is-editing');
        // Read current latex from ProseMirror doc (not the stale closure `node`)
        const pos = getPosition();
        const currentNode = pos !== null ? editor.state.doc.nodeAt(pos) : null;
        draft = (currentNode?.attrs.latex as string) ?? draft;
        input.value = draft;
        if (!dom.contains(input)) dom.appendChild(input);
        queueMicrotask(() => {
          input.focus();
          input.selectionStart = input.value.length;
          input.selectionEnd = input.value.length;
        });
      };

      const stopEditing = (commit: boolean) => {
        if (!isEditing) return;
        isEditing = false;
        dom.classList.remove('is-editing');
        const nextLatex = input.value;
        if (commit) {
          commitLatex(nextLatex);
          setRendered(nextLatex);
        }
        if (dom.contains(input)) dom.removeChild(input);
      };

      const onMouseDown = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        startEditing();
      };

      const onInputKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          stopEditing(true);
          editor.chain().focus().run();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          stopEditing(false);
          editor.chain().focus().run();
        }
      };

      const onDocumentMouseDown = (event: MouseEvent) => {
        if (!isEditing) return;
        const target = event.target as globalThis.Node | null;
        if (target && dom.contains(target)) return;
        stopEditing(true);
      };

      input.addEventListener('keydown', onInputKeyDown);
      input.addEventListener('mousedown', (e) => e.stopPropagation());
      dom.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousedown', onDocumentMouseDown, true);

      const initialLatex = (node.attrs.latex as string) ?? '';
      setRendered(initialLatex);
      if (initialLatex.trim().length === 0) {
        startEditing();
      }

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'mathInline') return false;
          const latex = (updatedNode.attrs.latex as string) ?? '';
          if (!isEditing) {
            setRendered(latex);
          }
          return true;
        },
        stopEvent: (event) => input.contains(event.target as globalThis.Node | null),
        ignoreMutation: () => true,
        destroy: () => {
          input.removeEventListener('keydown', onInputKeyDown);
          dom.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mousedown', onDocumentMouseDown, true);
        },
      };
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

export const mathBlockNode = TiptapNode.create({
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
          const latex = element.getAttribute('data-latex') ?? '';
          return { latex };
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
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('math-block');
      dom.className = 'math-block-editor';
      dom.contentEditable = 'false';

      const preview = document.createElement('div');
      preview.className = 'math-block-preview';

      const input = document.createElement('textarea');
      input.className = 'math-block-latex-input';
      input.placeholder = '输入 LaTeX，例如: \\frac{a+b}{c}';
      input.rows = 3;
      input.spellcheck = false;

      let isEditing = false;

      const setEditing = (editing: boolean) => {
        isEditing = editing;
        dom.classList.toggle('is-editing', editing);
        if (editing) {
          if (!dom.contains(input)) dom.appendChild(input);
        } else if (dom.contains(input)) {
          dom.removeChild(input);
        }
      };

      const setPreview = (latex: string) => {
        if (latex.trim().length === 0) {
          preview.innerHTML = '<span class="math-block-placeholder">公式预览</span>';
          return;
        }
        preview.innerHTML = renderKatex(latex, true);
      };

      const getPosition = (): number | null => {
        if (typeof getPos === 'function') {
          const resolved = getPos();
          return typeof resolved === 'number' ? resolved : null;
        }
        return typeof getPos === 'number' ? getPos : null;
      };

      const commitLatex = (latex: string) => {
        const pos = getPosition();
        if (pos === null) return;

        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== 'mathBlock') return;
        if ((currentNode.attrs.latex as string) === latex) return;

        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          latex,
        });
        editor.view.dispatch(tr);
      };

      const focusAfterNode = () => {
        const pos = getPosition();
        if (pos === null) return;
        const currentNode = editor.state.doc.nodeAt(pos);
        if (!currentNode) return;
        const afterPos = pos + currentNode.nodeSize;
        const $pos = editor.state.doc.resolve(Math.min(afterPos, editor.state.doc.content.size));
        const sel = TextSelection.near($pos, 1);
        editor.chain().focus().setTextSelection(sel).run();
      };

      const finishEditing = () => {
        const latex = input.value;
        commitLatex(latex);
        setPreview(latex);
        setEditing(false);
        focusAfterNode();
      };

      const startEditing = () => {
        // Read current latex from ProseMirror doc state
        const pos = getPosition();
        const currentNode = pos !== null ? editor.state.doc.nodeAt(pos) : null;
        const currentLatex = (currentNode?.attrs.latex as string) ?? '';
        input.value = currentLatex;
        setEditing(true);
        queueMicrotask(() => {
          input.focus();
          input.selectionStart = input.value.length;
          input.selectionEnd = input.value.length;
        });
      };

      const syncFromNode = (latex: string) => {
        dom.setAttribute('data-latex', latex);
        if (input.value !== latex) {
          input.value = latex;
        }
        setPreview(latex);
      };

      const onInput = () => {
        const latex = input.value;
        setPreview(latex);
        commitLatex(latex);
      };

      const onInputKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          finishEditing();
          return;
        }
        // Shift+Enter should insert newline in textarea (default behavior).
      };

      const onPreviewMouseDown = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        startEditing();
      };

      const onDocumentMouseDown = (event: MouseEvent) => {
        if (!isEditing) return;
        const target = event.target as globalThis.Node | null;
        if (target && dom.contains(target)) return;
        finishEditing();
      };

      const stopPropagation = (event: Event) => {
        event.stopPropagation();
      };

      input.addEventListener('input', onInput);
      input.addEventListener('keydown', onInputKeyDown);
      input.addEventListener('keydown', stopPropagation);
      input.addEventListener('mousedown', stopPropagation);
      input.addEventListener('click', stopPropagation);
      preview.addEventListener('mousedown', onPreviewMouseDown);
      document.addEventListener('mousedown', onDocumentMouseDown, true);

      dom.appendChild(preview);

      const initialLatex = (node.attrs.latex as string) ?? '';
      syncFromNode(initialLatex);

      if (initialLatex.trim().length === 0) {
        startEditing();
      } else {
        setEditing(false);
      }

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'mathBlock') return false;
          const latex = (updatedNode.attrs.latex as string) ?? '';
          if (!isEditing) {
            syncFromNode(latex);
          }
          return true;
        },
        stopEvent: (event) => input.contains(event.target as globalThis.Node | null),
        ignoreMutation: () => true,
        destroy: () => {
          input.removeEventListener('input', onInput);
          input.removeEventListener('keydown', onInputKeyDown);
          input.removeEventListener('keydown', stopPropagation);
          input.removeEventListener('mousedown', stopPropagation);
          input.removeEventListener('click', stopPropagation);
          preview.removeEventListener('mousedown', onPreviewMouseDown);
          document.removeEventListener('mousedown', onDocumentMouseDown, true);
        },
      };
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
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});

// ─── Combined export ───

export const mathExtension = [mathInlineNode, mathBlockNode];
