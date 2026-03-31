/**
 * paragraphIdPlugin — Assigns stable UUIDs to paragraph nodes.
 *
 * Each paragraph gets a unique `pid` attribute on creation.
 * The ID persists across transactions and is used for:
 * - Stable paragraph protection (instead of positional indices)
 * - Change tracking between AI generations
 * - Cross-reference anchoring
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';

const paragraphIdKey = new PluginKey('paragraphId');

/** Generate a short unique ID (not full UUID for performance) */
function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const paragraphIdPlugin = Extension.create({
  name: 'paragraphId',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          pid: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-pid') ?? null,
            renderHTML: (attributes) => {
              const pid = attributes.pid as string | null;
              if (!pid) return {};
              return { 'data-pid': pid };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paragraphIdKey,

        appendTransaction(
          transactions: readonly Transaction[],
          _oldState,
          newState,
        ): Transaction | null {
          // Only run when doc structure changed
          const hasDocChange = transactions.some((tr) => tr.docChanged);
          if (!hasDocChange) return null;

          let needsUpdate = false;
          const tr = newState.tr;

          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'paragraph' && !node.attrs.pid) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                pid: shortId(),
              });
              needsUpdate = true;
            }
          });

          if (!needsUpdate) return null;

          tr.setMeta('paragraphIdAssign', true);
          tr.setMeta('addToHistory', false); // Don't pollute undo history
          return tr;
        },
      }),
    ];
  },
});
