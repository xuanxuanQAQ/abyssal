import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../../core/store/useEditorStore';
import { useAIOperations } from './useAIOperations';

const executeMock = vi.fn();
const abortMock = vi.fn();

vi.mock('../../../core/hooks/useCopilotRuntime', () => ({
  useCopilotRuntime: () => ({
    execute: executeMock,
    abort: abortMock,
    resume: vi.fn(),
    getOperationStatus: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
    operations: new Map(),
    activeOperation: null,
  }),
}));

function createEditor(selection: { from: number; to: number } = { from: 16, to: 28 }) {
  return {
    getJSON: vi.fn(() => ({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, sectionId: 'sec-1' }, content: [{ type: 'text', text: 'Intro' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro body for continuity.' }] },
        { type: 'heading', attrs: { level: 1, sectionId: 'sec-2' }, content: [{ type: 'text', text: 'Method' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Selected text to rewrite and expand.' }] },
        { type: 'heading', attrs: { level: 1, sectionId: 'sec-3' }, content: [{ type: 'text', text: 'Results' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Results body.' }] },
      ],
    })),
    state: {
      selection,
      doc: {
        textBetween: vi.fn(() => 'Selected text to rewrite'),
      },
    },
  } as any;
}

function Harness({
  editor,
  onReady,
}: {
  editor: any;
  onReady: (ops: ReturnType<typeof useAIOperations>) => void;
}) {
  const ops = useAIOperations({
    editor,
    articleId: 'art-1',
    draftId: 'draft-1',
    sectionId: 'sec-2',
  });

  useEffect(() => {
    onReady(ops);
  }, [onReady, ops]);

  return null;
}

describe('useAIOperations', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let randomUuidSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    executeMock.mockReset();
    abortMock.mockReset();
    useEditorStore.getState().resetEditor();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    let callIndex = 0;
    randomUuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      callIndex += 1;
      return `op-${callIndex}`;
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    randomUuidSpy.mockRestore();
    useEditorStore.getState().resetEditor();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('builds a section generation operation with live continuity context', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-1', sessionId: 'writing:draft-1' });
    const editor = createEditor({ from: 16, to: 16 });
    let ops!: ReturnType<typeof useAIOperations>;

    useEditorStore.getState().setUnsavedChanges(true);

    act(() => {
      root.render(<Harness editor={editor} onReady={(value) => { ops = value; }} />);
    });

    await act(async () => {
      ops.generate();
      await Promise.resolve();
    });

    expect(executeMock).toHaveBeenCalledTimes(1);
    const envelope = executeMock.mock.calls[0][0];
    expect(envelope.operation.intent).toBe('generate-section');
    expect(envelope.operation.outputTarget).toEqual({
      type: 'section-replace',
      articleId: 'art-1',
      sectionId: 'sec-2',
    });
    expect(envelope.operation.context.article).toEqual(expect.objectContaining({
      articleId: 'art-1',
      sectionId: 'sec-2',
      sectionTitle: 'Method',
      previousSectionSummaries: [expect.stringContaining('Intro')],
      nextSectionTitles: ['Results'],
    }));
    expect(envelope.operation.context.writing).toEqual(expect.objectContaining({
      articleId: 'art-1',
      sectionId: 'sec-2',
      unsavedChanges: true,
    }));
    expect(useEditorStore.getState().aiGenerating).toBe(false);
  });

  it('builds selection rewrite operations from the live editor selection', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-1', sessionId: 'writing:draft-1' });
    const editor = createEditor();
    let ops!: ReturnType<typeof useAIOperations>;

    act(() => {
      root.render(<Harness editor={editor} onReady={(value) => { ops = value; }} />);
    });

    await act(async () => {
      ops.rewrite();
      await Promise.resolve();
    });

    const envelope = executeMock.mock.calls[0][0];
    expect(envelope.operation.intent).toBe('rewrite-selection');
    expect(envelope.operation.outputTarget).toEqual({
      type: 'editor-selection-replace',
      editorId: 'main',
      articleId: 'art-1',
      sectionId: 'sec-2',
      from: 16,
      to: 28,
    });
    expect(envelope.operation.context.selection).toEqual({
      kind: 'editor',
      articleId: 'art-1',
      sectionId: 'sec-2',
      selectedText: 'Selected text to rewrite',
      from: 16,
      to: 28,
    });
  });

  it('aborts the in-flight writing operation and clears editor generating state', async () => {
    executeMock.mockImplementation(() => new Promise(() => {}));
    abortMock.mockResolvedValue(undefined);
    const editor = createEditor({ from: 16, to: 16 });
    let ops!: ReturnType<typeof useAIOperations>;

    act(() => {
      root.render(<Harness editor={editor} onReady={(value) => { ops = value; }} />);
    });

    act(() => {
      ops.generate();
    });

    expect(useEditorStore.getState().aiGenerating).toBe(true);
    expect(useEditorStore.getState().aiGeneratingTaskId).toBe('op-1');

    await act(async () => {
      await ops.cancel();
    });

    expect(abortMock).toHaveBeenCalledWith('op-1');
    expect(useEditorStore.getState().aiGenerating).toBe(false);
    expect(useEditorStore.getState().aiGeneratingTaskId).toBeNull();
  });
});