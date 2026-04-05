import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const getSessionMock = vi.fn();
const editorStoreState = vi.hoisted(() => ({
  unsavedChanges: false,
}));

vi.mock('../../../core/ipc/bridge', () => ({
  getAPI: () => ({
    copilot: {
      execute: executeMock,
      getSession: getSessionMock,
    },
  }),
}));

vi.mock('../../../core/store/useEditorStore', () => ({
  useEditorStore: {
    getState: () => editorStoreState,
  },
}));

import {
  buildChatCopilotEnvelope,
  chatContextToSnapshot,
  executeCopilotTextRequest,
  mapCopilotToolStatus,
} from './copilotBridge';

describe('copilotBridge', () => {
  beforeEach(() => {
    executeMock.mockReset();
    getSessionMock.mockReset();
    editorStoreState.unsavedChanges = false;
  });

  it('maps editor chat context into a copilot snapshot', () => {
    editorStoreState.unsavedChanges = true;

    const snapshot = chatContextToSnapshot({
      activeView: 'writing',
      contextKey: 'section:abc',
      selectedArticleId: 'article-1',
      selectedDraftId: 'draft-1',
      selectedSectionId: 'section-1',
      editorSelectionText: 'selected paragraph',
      editorSelectionFrom: 12,
      editorSelectionTo: 34,
      selectedPaperIds: ['paper-2'],
      selectedPaperId: 'paper-1',
      selectedConceptId: 'concept-1',
    });

    expect(snapshot.article).toEqual({
      articleId: 'article-1',
      sectionId: 'section-1',
    });
    expect(snapshot.selection).toEqual({
      kind: 'editor',
      articleId: 'article-1',
      sectionId: 'section-1',
      selectedText: 'selected paragraph',
      from: 12,
      to: 34,
    });
    expect(snapshot.focusEntities.paperIds).toEqual(['paper-1', 'paper-2']);
    expect(snapshot.focusEntities.conceptIds).toEqual(['concept-1']);
    expect(snapshot.writing).toEqual({
      editorId: 'main',
      articleId: 'article-1',
      sectionId: 'section-1',
      unsavedChanges: true,
    });
  });

  it('uses editor store dirty state instead of inferring it from selection presence', () => {
    const snapshot = chatContextToSnapshot({
      activeView: 'writing',
      contextKey: 'section:def',
      selectedArticleId: 'article-1',
      selectedSectionId: 'section-1',
      editorSelectionText: 'selected paragraph',
      editorSelectionFrom: 12,
      editorSelectionTo: 34,
    });

    expect(snapshot.writing).toEqual({
      editorId: 'main',
      articleId: 'article-1',
      sectionId: 'section-1',
      unsavedChanges: false,
    });
  });

  it('builds a chat copilot envelope with a chat-message target', () => {
    const envelope = buildChatCopilotEnvelope('session-1', 'hello', {
      activeView: 'library',
      contextKey: 'library',
      selectedPaperId: 'paper-1',
    });

    expect(envelope.operation.sessionId).toBe('session-1');
    expect(envelope.operation.prompt).toBe('hello');
    expect(envelope.operation.surface).toBe('chat');
    expect(envelope.operation.intent).toBe('ask');
    expect(envelope.operation.outputTarget).toEqual({ type: 'chat-message' });
    expect(envelope.operation.context.focusEntities.paperIds).toEqual(['paper-1']);
  });

  it('executes a one-off copilot request and reconstructs final chat text from session timeline', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-1', sessionId: 'session-1' });
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      surface: 'chat',
      status: 'completed',
      intent: 'ask',
      currentGoal: undefined,
      activeOperationId: null,
      timeline: [
        { type: 'model.delta', operationId: 'op-1', channel: 'chat', text: 'hello ', sequence: 1, emittedAt: Date.now() },
        { type: 'model.delta', operationId: 'op-1', channel: 'chat', text: 'world', sequence: 2, emittedAt: Date.now() },
        { type: 'operation.completed', operationId: 'op-1', sequence: 3, emittedAt: Date.now() },
      ],
    });

    await expect(executeCopilotTextRequest({ prompt: 'test prompt' })).resolves.toBe('hello world');
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('throws the runtime failure message for one-off copilot requests', async () => {
    executeMock.mockResolvedValue({ operationId: 'op-2', sessionId: 'session-2' });
    getSessionMock.mockResolvedValue({
      id: 'session-2',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      surface: 'chat',
      status: 'failed',
      intent: 'ask',
      currentGoal: undefined,
      activeOperationId: null,
      timeline: [
        { type: 'operation.failed', operationId: 'op-2', code: 'LLM_ERROR', message: 'provider timeout', sequence: 1, emittedAt: Date.now() },
      ],
    });

    await expect(executeCopilotTextRequest({ prompt: 'test prompt' })).rejects.toThrow('provider timeout');
  });

  it('normalizes failed tool states for chat rendering', () => {
    expect(mapCopilotToolStatus('pending')).toBe('pending');
    expect(mapCopilotToolStatus('running')).toBe('running');
    expect(mapCopilotToolStatus('completed')).toBe('completed');
    expect(mapCopilotToolStatus('failed')).toBe('error');
  });
});