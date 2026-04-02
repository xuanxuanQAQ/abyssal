/**
 * imageExtension — ProseMirror node for images/figures.
 *
 * Supports:
 * - Asset-based images (asset://id) stored in workspace
 * - External URL images
 * - Configurable width, alt text, caption
 * - Figure numbering via label attribute (for cross-references)
 */

import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      insertFigure: (attrs: Record<string, unknown>) => ReturnType;
    };
  }
}

export const imageExtension = Node.create({
  name: 'figure',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.querySelector('img')?.getAttribute('src') ?? null,
      },
      alt: {
        default: '',
        parseHTML: (el) => el.querySelector('img')?.getAttribute('alt') ?? '',
      },
      title: {
        default: null,
        parseHTML: (el) => el.querySelector('img')?.getAttribute('title') ?? null,
      },
      caption: {
        default: '',
        parseHTML: (el) =>
          el.querySelector('figcaption')?.textContent ?? '',
      },
      width: {
        default: null,
        parseHTML: (el) => el.querySelector('img')?.getAttribute('width') ?? null,
      },
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id') ?? null,
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label') ?? null,
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'figure' },
    ];
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    const { src, alt, title, caption, width, assetId, label } = HTMLAttributes;

    const figureAttrs: Record<string, string> = {
      class: 'tiptap-figure',
      style: 'margin: 16px 0; text-align: center;',
    };
    if (assetId) figureAttrs['data-asset-id'] = assetId as string;
    if (label) figureAttrs['data-label'] = label as string;

    const imgAttrs: Record<string, string> = {
      style: 'max-width: 100%; height: auto; border-radius: 4px;',
    };
    if (src) imgAttrs.src = src as string;
    if (alt) imgAttrs.alt = alt as string;
    if (title) imgAttrs.title = title as string;
    if (width) imgAttrs.width = width as string;

    const children: DOMOutputSpec = ['figure', figureAttrs, ['img', imgAttrs]];

    if (caption) {
      (children as [string, Record<string, string>, ...DOMOutputSpec[]]).push([
        'figcaption',
        {
          style:
            'font-size: 12px; color: var(--text-muted); margin-top: 8px; font-style: italic;',
        },
        caption as string,
      ]);
    }

    return children;
  },

  addCommands() {
    return {
      insertFigure:
        (attrs: Record<string, unknown>) =>
        ({ chain }: CommandProps) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run();
        },
    };
  },
});
