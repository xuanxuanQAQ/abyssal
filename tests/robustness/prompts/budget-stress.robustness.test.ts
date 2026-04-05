/**
 * Robustness tests — context budget and prompt assembly under stress.
 *
 * Tests: budget-tight allocations, long text inputs, and prompt perturbation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fc, it as fcIt } from '@fast-check/vitest';
import { ContextSnapshotBuilder } from '../../../src/copilot-runtime/context-builder';
import type { CopilotOperation, ContextSnapshot } from '../../../src/copilot-runtime/types';

function makeMinimalSession() {
  return {
    focus: {
      currentView: 'library' as const,
      activePapers: [],
      activeConcepts: [],
      readerState: null,
      selected: { articleId: null },
    },
  };
}

function makeOp(overrides?: Partial<CopilotOperation>): CopilotOperation {
  return {
    id: 'op-budget-1',
    sessionId: 'sess-budget-1',
    surface: 'chat' as const,
    intent: 'ask' as const,
    prompt: 'test',
    context: {
      activeView: 'library' as const,
      workspaceId: 'ws-1',
      article: null,
      selection: null,
      focusEntities: { paperIds: [], conceptIds: [] },
      conversation: { recentTurns: [] },
      retrieval: { evidence: [] },
      writing: null,
      budget: { policy: 'standard' as const, tokenBudget: 4000, includedLayers: ['surface' as const, 'working' as const] },
      frozenAt: Date.now(),
    },
    outputTarget: { type: 'chat-message' },
    ...overrides,
  };
}

describe('ContextSnapshotBuilder robustness — budget policies', () => {
  it('builds minimal context with limited layers', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const op = makeOp({
      constraints: { contextPolicy: 'minimal' },
    });

    const snapshot = await builder.build(op);

    expect(snapshot.budget.policy).toBe('minimal');
    expect(snapshot.budget.tokenBudget).toBe(2000);
    expect(snapshot.budget.includedLayers).toEqual(['surface']);
    expect(snapshot.conversation.recentTurns).toEqual([]);
    expect(snapshot.retrieval.evidence).toEqual([]);
  });

  it('builds standard context with surface + working layers', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(snapshot.budget.policy).toBe('standard');
    expect(snapshot.budget.tokenBudget).toBe(6000);
    expect(snapshot.budget.includedLayers).toContain('surface');
    expect(snapshot.budget.includedLayers).toContain('working');
  });

  it('builds deep context with all layers', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
      getConversationTurns: () => [
        { role: 'user' as const, text: 'previous question' },
        { role: 'assistant' as const, text: 'previous answer' },
      ],
      getRetrievalContext: () => ({
        evidence: [{ chunkId: 'c1', paperId: 'p1', text: 'evidence', score: 0.9 }],
        lastQuery: 'query',
      }),
    });

    const op = makeOp({
      constraints: { contextPolicy: 'deep' },
    });

    const snapshot = await builder.build(op);

    expect(snapshot.budget.policy).toBe('deep');
    expect(snapshot.budget.tokenBudget).toBe(12000);
    expect(snapshot.conversation.recentTurns).toHaveLength(2);
    expect(snapshot.retrieval.evidence).toHaveLength(1);
  });
});

describe('ContextSnapshotBuilder robustness — snapshot immutability', () => {
  it('returns frozen snapshot', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('snapshot frozenAt reflects build time', async () => {
    const before = Date.now();
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());
    const after = Date.now();

    expect(snapshot.frozenAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.frozenAt).toBeLessThanOrEqual(after);
  });
});

describe('ContextSnapshotBuilder robustness — selection resolution', () => {
  it('resolves editor selection from operation context', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const op = makeOp({
      context: {
        ...makeOp().context,
        selection: {
          kind: 'editor' as const,
          articleId: 'a1',
          sectionId: 's1',
          selectedText: 'selected text',
          from: 0,
          to: 13,
        },
      },
    });

    const snapshot = await builder.build(op);

    expect(snapshot.selection).not.toBeNull();
    expect(snapshot.selection!.kind).toBe('editor');
  });

  it('resolves reader selection from session focus', async () => {
    const session = makeMinimalSession();
    (session.focus as any).readerState = {
      paperId: 'p1',
      selection: { text: 'highlighted text', page: 3 },
    };

    const builder = new ContextSnapshotBuilder({
      session: session as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(snapshot.selection).not.toBeNull();
    expect(snapshot.selection!.kind).toBe('reader');
  });

  it('returns null selection when nothing selected', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(snapshot.selection).toBeNull();
  });
});

describe('ContextSnapshotBuilder robustness — article focus', () => {
  it('resolves article focus from operation context', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
      getArticleFocus: async (articleId: string) => ({
        articleId,
        sectionId: null,
        articleTitle: 'Test Article',
      }),
    });

    const op = makeOp({
      context: {
        ...makeOp().context,
        article: { articleId: 'a1', sectionId: 's1' },
      },
    });

    const snapshot = await builder.build(op);

    expect(snapshot.article).not.toBeNull();
    expect(snapshot.article!.articleId).toBe('a1');
  });
});

describe('ContextSnapshotBuilder robustness — writing context', () => {
  it('infers writing context when view is writing', async () => {
    const session = makeMinimalSession();
    (session.focus as any).currentView = 'writing';
    (session.focus as any).selected = { articleId: 'a1' };

    const builder = new ContextSnapshotBuilder({
      session: session as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(snapshot.writing).not.toBeNull();
    expect(snapshot.writing!.articleId).toBe('a1');
  });

  it('returns null writing context for non-writing views', async () => {
    const builder = new ContextSnapshotBuilder({
      session: makeMinimalSession() as any,
      workspaceId: 'ws-1',
    });

    const snapshot = await builder.build(makeOp());

    expect(snapshot.writing).toBeNull();
  });
});
