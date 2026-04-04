import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyEditorPatch,
  shouldHandleEditorPatch,
  useEditorCommandBridge,
} from './useEditorCommandBridge';

function createChain(run = vi.fn().mockReturnValue(true)) {
  return {
    focus: vi.fn().mockReturnThis(),
    insertContentAt: vi.fn().mockReturnThis(),
    run,
  };
}

function createEditor(overrides?: Record<string, unknown>) {
  const chain = createChain();
  return {
    isDestroyed: false,
    state: { doc: { content: { size: 99 } } },
    chain: vi.fn(() => chain),
    commands: {
      setContent: vi.fn(),
    },
    getJSON: vi.fn(() => ({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, sectionId: 'sec-1' }, content: [{ type: 'text', text: 'Intro' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Old body' }] },
      ],
    })),
    ...overrides,
  } as any;
}

function Harness({ editor, articleId, persistDocument }: { editor: any; articleId: string; persistDocument: () => void | Promise<void> }) {
  useEditorCommandBridge({ editor, articleId, persistDocument });
  return null;
}

describe('useEditorCommandBridge', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('filters patches by article id precondition', () => {
    expect(shouldHandleEditorPatch('art-1', {
      kind: 'replace-range',
      editorId: 'main',
      from: 0,
      to: 1,
      content: { type: 'doc', content: [] },
      preconditions: { articleId: 'art-1', sectionId: 'sec-1', editorId: 'main' },
    } as any)).toBe(true);

    expect(shouldHandleEditorPatch('art-1', {
      kind: 'replace-range',
      editorId: 'main',
      from: 0,
      to: 1,
      content: { type: 'doc', content: [] },
      preconditions: { articleId: 'art-2', sectionId: 'sec-1', editorId: 'main' },
    } as any)).toBe(false);
  });

  it('applies replace-range patches through insertContentAt', () => {
    const editor = createEditor();
    const chain = editor.chain();

    const applied = applyEditorPatch(editor, {
      kind: 'replace-range',
      editorId: 'main',
      from: 3,
      to: 8,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    } as any);

    expect(applied).toBe(true);
    expect(chain.focus).toHaveBeenCalled();
    expect(chain.insertContentAt).toHaveBeenCalledWith({ from: 3, to: 8 }, { type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('applies insert-at patches using document end when pos is -1', () => {
    const editor = createEditor();
    const chain = editor.chain();

    const applied = applyEditorPatch(editor, {
      kind: 'insert-at',
      editorId: 'main',
      pos: -1,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    } as any);

    expect(applied).toBe(true);
    expect(chain.insertContentAt).toHaveBeenCalledWith(99, { type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('replaces section bodies via setContent for replace-section patches', () => {
    const editor = createEditor();

    const applied = applyEditorPatch(editor, {
      kind: 'replace-section',
      editorId: 'main',
      sectionId: 'sec-1',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New body' }] }],
      },
    } as any);

    expect(applied).toBe(true);
    expect(editor.commands.setContent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'doc',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'heading' }),
          expect.objectContaining({ type: 'paragraph' }),
        ]),
      }),
      { emitUpdate: true },
    );
  });

  it('handles AI patch and persist events for the active article', async () => {
    const editor = createEditor();
    const persistDocument = vi.fn();

    act(() => {
      root.render(<Harness editor={editor} articleId="art-1" persistDocument={persistDocument} />);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('ai:applyEditorPatch', {
        detail: {
          command: 'apply-editor-patch',
          patch: {
            kind: 'replace-range',
            editorId: 'main',
            from: 0,
            to: 2,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            preconditions: { articleId: 'art-1', sectionId: 'sec-1', editorId: 'main' },
          },
        },
      }));
      window.dispatchEvent(new CustomEvent('ai:persistDocument', {
        detail: {
          command: 'persist-document',
          articleId: 'art-1',
        },
      }));
    });

    const chain = editor.chain();
    expect(chain.insertContentAt).toHaveBeenCalled();
    expect(persistDocument).toHaveBeenCalled();
  });

  it('ignores commands targeting another article', () => {
    const editor = createEditor();
    const persistDocument = vi.fn();

    act(() => {
      root.render(<Harness editor={editor} articleId="art-1" persistDocument={persistDocument} />);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('ai:applyEditorPatch', {
        detail: {
          command: 'apply-editor-patch',
          patch: {
            kind: 'replace-range',
            editorId: 'main',
            from: 0,
            to: 2,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
            preconditions: { articleId: 'art-2', sectionId: 'sec-1', editorId: 'main' },
          },
        },
      }));
      window.dispatchEvent(new CustomEvent('ai:persistDocument', {
        detail: {
          command: 'persist-document',
          articleId: 'art-2',
        },
      }));
    });

    const chain = editor.chain();
    expect(chain.insertContentAt).not.toHaveBeenCalled();
    expect(persistDocument).not.toHaveBeenCalled();
  });
});