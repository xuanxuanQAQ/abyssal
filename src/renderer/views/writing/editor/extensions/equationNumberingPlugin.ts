/**
 * equationNumberingPlugin — Adds automatic numbering to mathBlock nodes.
 *
 * Assigns sequential equation numbers and optional labels for cross-referencing.
 * Renders equation numbers as (1), (2), etc. on the right side of display math.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const equationNumberKey = new PluginKey('equationNumbering');

function buildEquationDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  let eqNumber = 0;

  doc.descendants((node, pos) => {
    if (node.type.name === 'mathBlock') {
      eqNumber++;

      // Widget at the end of the math block showing the equation number
      const widget = Decoration.widget(
        pos + node.nodeSize,
        () => {
          const tag = document.createElement('span');
          tag.className = 'equation-number';
          tag.style.cssText =
            'position: absolute; right: 0; top: 50%; transform: translateY(-50%); ' +
            'font-size: 14px; color: var(--text-muted); user-select: none;';
          tag.textContent = `(${eqNumber})`;
          return tag;
        },
        { side: -1, key: `eq-num-${pos}` },
      );
      decorations.push(widget);
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const equationNumberingPlugin = Extension.create({
  name: 'equationNumbering',

  addGlobalAttributes() {
    return [
      {
        types: ['mathBlock'],
        attributes: {
          label: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-eq-label') ?? null,
            renderHTML: (attributes) => {
              const label = attributes.label as string | null;
              if (!label) return {};
              return { 'data-eq-label': label };
            },
          },
          eqNumber: {
            default: null,
            // Computed at render time, not persisted
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: equationNumberKey,

        state: {
          init(_, { doc }) {
            return buildEquationDecorations(doc);
          },
          apply(tr, oldSet) {
            if (!tr.docChanged) return oldSet;
            return buildEquationDecorations(tr.doc);
          },
        },

        props: {
          decorations(state) {
            return equationNumberKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
