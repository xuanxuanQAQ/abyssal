/**
 * CitationNode — inline atom node for academic citations.
 *
 * Renders as <cite-node> in the DOM with a ReactNodeView (CitationChip).
 * Input rule: [@paperId] inserts a CitationNode.
 *
 * 【Δ-5】Delete protection: two-step backspace/delete behaviour near atom nodes.
 */

import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CitationChip } from './CitationChip';

const CITATION_INPUT_REGEX = /\[@([a-zA-Z0-9_-]+)\]$/;

const citationDeleteProtectionKey = new PluginKey('citationDeleteProtection');

/**
 * 【Δ-5】Delete protection plugin for CitationNode.
 *
 * When the cursor is immediately adjacent to an atom node:
 * - First keypress (Backspace/Delete) selects the node (NodeSelection)
 * - Second keypress deletes it
 */
function createDeleteProtectionPlugin(): Plugin {
  return new Plugin({
    key: citationDeleteProtectionKey,
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { selection, doc } = state;

        // Only handle Backspace / Delete
        if (event.key !== 'Backspace' && event.key !== 'Delete') {
          return false;
        }

        // If we already have a NodeSelection on a citationNode, let default delete handle it
        if (selection instanceof NodeSelection && selection.node.type.name === 'citationNode') {
          return false;
        }

        // Only intercept from text cursor (not range selections)
        if (!selection.empty) {
          return false;
        }

        const $pos = selection.$from;

        if (event.key === 'Backspace') {
          // Check if the position immediately before the cursor is a citationNode
          if ($pos.nodeBefore?.type.name === 'citationNode') {
            const nodePos = $pos.pos - $pos.nodeBefore.nodeSize;
            const tr = state.tr.setSelection(NodeSelection.create(doc, nodePos));
            view.dispatch(tr);
            return true;
          }
        }

        if (event.key === 'Delete') {
          // Check if the position immediately after the cursor is a citationNode
          if ($pos.nodeAfter?.type.name === 'citationNode') {
            const nodePos = $pos.pos;
            const tr = state.tr.setSelection(NodeSelection.create(doc, nodePos));
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
  });
}

export const citationExtension = Node.create({
  name: 'citationNode',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      paperId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-paper-id') ?? '',
      },
      displayText: {
        default: '',
        parseHTML: (element) => element.textContent ?? '',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'cite-node',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            paperId: element.getAttribute('data-paper-id') ?? '',
            displayText: element.textContent ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'cite-node',
      mergeAttributes({ 'data-paper-id': HTMLAttributes.paperId }),
      HTMLAttributes.displayText,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationChip);
  },

  addInputRules() {
    return [
      new InputRule({
        find: CITATION_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const paperId = match[1] ?? '';
          const attrs = { paperId, displayText: `@${paperId}` };
          const node = state.schema.nodes.citationNode?.create(attrs);
          if (!node) return;
          const tr = state.tr.replaceWith(range.from, range.to, node);
          // Move cursor after the inserted node
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(range.from + node.nodeSize))
          );
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [createDeleteProtectionPlugin()];
  },
});
