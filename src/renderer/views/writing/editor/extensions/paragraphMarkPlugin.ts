/**
 * 【Δ-2】ParagraphMark system — decoration plugin + splitBlock interceptor.
 *
 * A) Decoration Plugin:
 *    Iterates all paragraph nodes, checks attrs.mark.
 *    For non-null marks, creates Widget Decoration (position: absolute, right: 0, top: 0).
 *    Labels: HUMAN-ORIGINAL -> gray, AI-WRITTEN -> blue, AI-REWRITTEN -> purple.
 *
 * B) splitBlock interceptor:
 *    Override Enter key: after splitBlock, reset the new (second) paragraph's
 *    attrs.mark to null via appendTransaction.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

export type ParagraphMark = 'HUMAN-ORIGINAL' | 'AI-WRITTEN' | 'AI-REWRITTEN' | null;

const paragraphMarkDecoKey = new PluginKey('paragraphMarkDecoration');

// ─── Label config ───

interface MarkLabel {
  emoji: string;
  label: string;
  color: string;
  bgColor: string;
}

const MARK_LABELS: Record<string, MarkLabel> = {
  'HUMAN-ORIGINAL': {
    emoji: '\u{1F464}',
    label: 'Human',
    color: '#888',
    bgColor: 'rgba(136,136,136,0.12)',
  },
  'AI-WRITTEN': {
    emoji: '\u{1F916}',
    label: 'AI',
    color: '#89b4fa',
    bgColor: 'rgba(137,180,250,0.12)',
  },
  'AI-REWRITTEN': {
    emoji: '\u{1F504}',
    label: 'Rewrite',
    color: '#cba6f7',
    bgColor: 'rgba(203,166,247,0.12)',
  },
};

// ─── Widget creator ───

function createMarkWidget(mark: string): HTMLElement {
  const config = MARK_LABELS[mark];
  if (!config) {
    const fallback = document.createElement('span');
    return fallback;
  }

  const tag = document.createElement('span');
  tag.style.position = 'absolute';
  tag.style.right = '0';
  tag.style.top = '0';
  tag.style.height = '18px';
  tag.style.padding = '0 6px';
  tag.style.fontSize = '10px';
  tag.style.borderRadius = '3px';
  tag.style.lineHeight = '18px';
  tag.style.color = config.color;
  tag.style.backgroundColor = config.bgColor;
  tag.style.pointerEvents = 'none';
  tag.style.userSelect = 'none';
  tag.style.whiteSpace = 'nowrap';
  tag.textContent = `${config.emoji} ${config.label}`;

  return tag;
}

// ─── Decoration Plugin ───

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return;

    const mark = node.attrs.mark as ParagraphMark | undefined;
    if (mark == null) return;

    // Widget decoration at the start of the paragraph (rendered absolutely)
    const widget = Decoration.widget(pos + 1, () => createMarkWidget(mark), {
      side: -1,
      key: `para-mark-${pos}`,
    });
    decorations.push(widget);
  });

  return DecorationSet.create(doc, decorations);
}

function createDecorationPlugin(): Plugin {
  return new Plugin({
    key: paragraphMarkDecoKey,

    state: {
      init(_, { doc }): DecorationSet {
        return buildDecorations(doc);
      },

      apply(tr, oldSet): DecorationSet {
        if (!tr.docChanged) return oldSet;

        // Check if any step might have changed paragraph structure or marks.
        // For pure text-only changes within a paragraph, just map decorations
        // instead of doing an O(n) rebuild over all paragraphs.
        let needsRebuild = false;
        for (const step of tr.steps) {
          const json = step.toJSON() as Record<string, unknown> | null;
          if (json && typeof json === 'object' && 'stepType' in json) {
            if (json.stepType !== 'replace') {
              needsRebuild = true;
              break;
            }
          }
        }

        if (needsRebuild) {
          return buildDecorations(tr.doc);
        }

        return oldSet.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state): DecorationSet {
        return paragraphMarkDecoKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

// ─── SplitBlock interceptor ───
// Detect when a transaction splits a paragraph and reset the new paragraph's mark to null.

function _isSplitTransaction(tr: Transaction): boolean {
  // A splitBlock transaction typically adds one step that splits a node.
  // We detect it by checking if the number of paragraphs increased by exactly one.
  if (!tr.docChanged) return false;
  // Check for splitBlock metadata
  if (tr.getMeta('splitBlock')) return true;
  return false;
}

function createSplitBlockInterceptor(): Plugin {
  return new Plugin({
    key: new PluginKey('paragraphMarkSplitInterceptor'),

    appendTransaction(transactions, oldState, newState): Transaction | null {
      // Check if any transaction resulted from a split.
      // Use O(1) childCount comparison instead of O(n) descendants traversal.
      const hasSplit = newState.doc.childCount > oldState.doc.childCount;

      if (!hasSplit) return null;

      // Find paragraphs in the new state that have a mark attribute and are "new"
      // (their content is empty or they are at the cursor position after split).
      const { selection } = newState;
      const $pos = selection.$from;

      // The new paragraph after split is the one containing the cursor
      const currentNode = $pos.parent;
      if (currentNode.type.name !== 'paragraph') return null;

      const currentMark = currentNode.attrs.mark as ParagraphMark | undefined;
      if (currentMark == null) return null;

      // Reset the mark on the new (cursor-containing) paragraph
      const paragraphStart = $pos.before($pos.depth);
      const tr = newState.tr.setNodeMarkup(paragraphStart, undefined, {
        ...currentNode.attrs,
        mark: null,
      });
      tr.setMeta('paragraphMarkReset', true);
      return tr;
    },
  });
}

// ─── Combined Extension ───

export const paragraphMarkPlugin = Extension.create({
  name: 'paragraphMark',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          mark: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-mark') ?? null,
            renderHTML: (attributes) => {
              const mark = attributes.mark as ParagraphMark | undefined;
              if (mark == null) return {};
              return { 'data-mark': mark, style: 'position: relative;' };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [createDecorationPlugin(), createSplitBlockInterceptor()];
  },
});
