/**
 * ghostSelectionPlugin — 当编辑器失焦时，渲染持久化写作锚点的视觉反馈。
 *
 * - range target → 淡色背景高亮（ghost selection）
 * - caret target → 所在段落弱高亮 + 虚线光标指示
 *
 * 通过 ProseMirror Decoration 实现，与 paragraphMarkPlugin 同层。
 * 从 useEditorStore.persistedWritingTarget 读取状态。
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { useEditorStore } from '../../../../core/store/useEditorStore';

const ghostSelectionKey = new PluginKey('ghostSelection');

function buildGhostDecorations(view: EditorView): DecorationSet {
  const { editorFocused, persistedWritingTarget } = useEditorStore.getState();

  // 编辑器有焦点时，原生选区已可见，不需要 ghost
  if (editorFocused || !persistedWritingTarget) {
    return DecorationSet.empty;
  }

  const docSize = view.state.doc.content.size;
  const decorations: Decoration[] = [];

  if (persistedWritingTarget.kind === 'range') {
    const from = Math.max(0, Math.min(persistedWritingTarget.from, docSize));
    const to = Math.max(from, Math.min(persistedWritingTarget.to, docSize));

    if (from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: 'ghost-selection-range',
          style: [
            'background: color-mix(in srgb, var(--accent-color) 12%, transparent)',
            'border-bottom: 1.5px dashed color-mix(in srgb, var(--accent-color) 35%, transparent)',
            'border-radius: 2px',
            'transition: background 200ms ease, border-color 200ms ease',
          ].join(';'),
        }),
      );
    }
  } else if (persistedWritingTarget.kind === 'caret') {
    const pos = Math.max(0, Math.min(persistedWritingTarget.from, docSize));

    // 在 caret 位置插入一个 widget 装饰作为虚线光标指示
    decorations.push(
      Decoration.widget(pos, () => {
        const marker = document.createElement('span');
        marker.className = 'ghost-caret-marker';
        marker.style.cssText = [
          'display: inline-block',
          'width: 1.5px',
          'height: 1.1em',
          'background: color-mix(in srgb, var(--accent-color) 50%, transparent)',
          'border-radius: 1px',
          'vertical-align: text-bottom',
          'margin: 0 -0.75px',
          'animation: ghost-caret-blink 1.2s ease-in-out infinite',
          'pointer-events: none',
        ].join(';');
        return marker;
      }, {
        side: 0,
        key: 'ghost-caret',
      }),
    );

    // 在 caret 所在段落添加弱背景高亮
    const resolved = view.state.doc.resolve(pos);
    for (let depth = resolved.depth; depth >= 0; depth--) {
      const node = resolved.node(depth);
      if (node.type.name === 'paragraph') {
        const paragraphStart = resolved.before(depth);
        const paragraphEnd = resolved.after(depth);
        decorations.push(
          Decoration.node(paragraphStart, paragraphEnd, {
            class: 'ghost-caret-paragraph',
            style: [
              'background: color-mix(in srgb, var(--accent-color) 5%, transparent)',
              'border-left: 2px solid color-mix(in srgb, var(--accent-color) 25%, transparent)',
              'border-radius: 2px',
              'transition: background 200ms ease',
            ].join(';'),
          }),
        );
        break;
      }
    }
  }

  return DecorationSet.create(view.state.doc, decorations);
}

function createGhostSelectionPlugin(): Plugin {
  return new Plugin({
    key: ghostSelectionKey,

    state: {
      init(_, state) {
        return DecorationSet.empty;
      },

      apply(tr, oldSet, _oldState, newState) {
        // 每次 transaction 都重新计算（频率不高，因为离焦后编辑操作极少）
        // 实际重建由 view.update 触发
        return oldSet;
      },
    },

    view(editorView) {
      let currentDecos = buildGhostDecorations(editorView);

      // 订阅 store 变化来更新装饰
      const unsub = useEditorStore.subscribe(
        (state) => ({
          focused: state.editorFocused,
          target: state.persistedWritingTarget,
        }),
        () => {
          currentDecos = buildGhostDecorations(editorView);
          editorView.dispatch(editorView.state.tr.setMeta(ghostSelectionKey, true));
        },
        { equalityFn: (a, b) => a.focused === b.focused && a.target === b.target },
      );

      return {
        update(view) {
          currentDecos = buildGhostDecorations(view);
        },
        destroy() {
          unsub();
        },
      };
    },

    props: {
      decorations(state) {
        // 使用 view 回调更新的装饰
        const editorView = (this as unknown as { spec: { view?: (v: EditorView) => Record<string, unknown> } }).spec;
        // 由于 ProseMirror 的 plugin decorations 在 view.update 后会被重新取值，
        // 我们利用 plugin state 机制 + meta 触发更新
        const meta = state.tr?.getMeta?.(ghostSelectionKey);
        // 实际的装饰在 view callback 中计算并缓存
        return DecorationSet.empty;
      },
    },
  });
}

/**
 * 独立重构：使用更可靠的 decorations 返回方式。
 * ProseMirror decorations prop 从 Plugin state 读取，
 * view.update 每次都写入 plugin state。
 */
function createGhostSelectionPluginV2(): Plugin {
  let cachedView: EditorView | null = null;
  let cachedDecos: DecorationSet = DecorationSet.empty;
  let rafHandle: number | null = null;

  const rebuild = () => {
    if (!cachedView) return;
    // 使用 rAF 避免同步 dispatch 循环
    // （store 变化 → rebuild → dispatch → transaction → syncEditorSelection → store 变化）
    if (rafHandle !== null) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      if (!cachedView) return;
      cachedDecos = buildGhostDecorations(cachedView);
      cachedView.dispatch(cachedView.state.tr.setMeta(ghostSelectionKey, true).setMeta('addToHistory', false));
    });
  };

  let unsub: (() => void) | null = null;

  return new Plugin({
    key: ghostSelectionKey,

    view(editorView) {
      cachedView = editorView;
      cachedDecos = buildGhostDecorations(editorView);

      unsub = useEditorStore.subscribe(
        (state) => ({
          focused: state.editorFocused,
          target: state.persistedWritingTarget,
        }),
        rebuild,
        { equalityFn: (a, b) => a.focused === b.focused && a.target === b.target },
      );

      return {
        update(view) {
          cachedView = view;
          cachedDecos = buildGhostDecorations(view);
        },
        destroy() {
          unsub?.();
          unsub = null;
          if (rafHandle !== null) cancelAnimationFrame(rafHandle);
          rafHandle = null;
          cachedView = null;
          cachedDecos = DecorationSet.empty;
        },
      };
    },

    props: {
      decorations() {
        return cachedDecos;
      },
    },
  });
}

export const ghostSelectionPlugin = Extension.create({
  name: 'ghostSelection',

  addProseMirrorPlugins() {
    return [createGhostSelectionPluginV2()];
  },
});
