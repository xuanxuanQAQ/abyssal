import Heading from '@tiptap/extension-heading';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const outlineHeadingExtension = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sectionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-section-id'),
        renderHTML: (attributes) => (
          attributes.sectionId
            ? { 'data-section-id': String(attributes.sectionId) }
            : {}
        ),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('outline-heading-id-normalizer'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          let nextTransaction = newState.tr;
          let changed = false;

          newState.doc.descendants((node, pos) => {
            if (node.type !== newState.schema.nodes.heading) return true;

            const level = Number(node.attrs.level ?? 1);
            const sectionId = typeof node.attrs.sectionId === 'string'
              ? node.attrs.sectionId
              : '';

            if (level >= 1 && level <= 3) {
              if (sectionId.length === 0) {
                nextTransaction = nextTransaction.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  sectionId: crypto.randomUUID(),
                });
                changed = true;
              }
            } else if (sectionId.length > 0) {
              nextTransaction = nextTransaction.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                sectionId: null,
              });
              changed = true;
            }

            return true;
          });

          return changed ? nextTransaction : null;
        },
      }),
    ];
  },
});