import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatContext } from './useChatContext';

const state = vi.hoisted(() => ({
  app: {
    activeView: 'writing',
    selectedArticleId: 'article-1',
    selectedDraftId: 'draft-1',
  },
  reader: {
    quotedSelection: null,
    selectionPayload: null,
  },
  editor: {
    editorSelection: {
      articleId: 'article-1',
      draftId: 'draft-1',
      sectionId: 'section-2',
      from: 12,
      to: 24,
      selectedText: '待改写段落',
    },
  },
  source: {
    type: 'section',
    articleId: 'article-1',
    draftId: 'draft-1',
    sectionId: 'section-2',
  },
}));

vi.mock('../../../../core/store', () => ({
  useAppStore: {
    getState: () => state.app,
  },
}));

vi.mock('../../../../core/store/useReaderStore', () => ({
  useReaderStore: {
    getState: () => state.reader,
  },
}));

vi.mock('../../../../core/store/useEditorStore', () => ({
  useEditorStore: {
    getState: () => state.editor,
  },
}));

vi.mock('../../engine/useEffectiveSource', () => ({
  useEffectiveSource: () => state.source,
}));

vi.mock('../../engine/contextSourceKey', () => ({
  contextSourceKey: () => 'section:section-2',
}));

let latestBuilder: ReturnType<typeof useChatContext> | null = null;

function Harness() {
  latestBuilder = useChatContext();
  return null;
}

describe('useChatContext', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestBuilder = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('includes writing editor selection in chat context', () => {
    act(() => {
      root.render(<Harness />);
    });

    expect(latestBuilder).not.toBeNull();
    expect(latestBuilder?.()).toEqual({
      activeView: 'writing',
      contextKey: 'section:section-2',
      selectedArticleId: 'article-1',
      selectedDraftId: 'draft-1',
      selectedSectionId: 'section-2',
      editorSelectionText: '待改写段落',
      editorSelectionFrom: 12,
      editorSelectionTo: 24,
    });
  });
});
