import { act } from 'react';
import type { Editor } from '@tiptap/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorToolbar } from './EditorToolbar';

const translateMock = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateMock }),
}));

function createChain() {
  const target: Record<string, unknown> = {
    run: vi.fn(() => true),
  };
  const proxy = new Proxy(target, {
    get(currentTarget, prop) {
      if (!(prop in currentTarget)) {
        currentTarget[prop as string] = vi.fn(() => proxy);
      }
      return currentTarget[prop as string];
    },
  });
  return proxy;
}

function createMockEditor() {
  const chain = createChain();
  return {
    on: vi.fn(),
    off: vi.fn(),
    isActive: vi.fn(() => false),
    can: vi.fn(() => ({ chain: vi.fn(() => chain) })),
    chain: vi.fn(() => chain),
    getAttributes: vi.fn(() => ({})),
  } as unknown as Editor;
}

describe('EditorToolbar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('subscribes to transaction events so toolbar state refreshes after formatting commands', () => {
    const editor = createMockEditor();

    act(() => {
      root.render(<EditorToolbar editor={editor} />);
    });

    expect(editor.on).toHaveBeenCalledWith('selectionUpdate', expect.any(Function));
    expect(editor.on).toHaveBeenCalledWith('transaction', expect.any(Function));

    act(() => {
      root.unmount();
    });

    expect(editor.off).toHaveBeenCalledWith('selectionUpdate', expect.any(Function));
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });
});