import { ContextSnapshotBuilder } from '../context-builder';
import type { ContextBuildDeps } from '../context-builder';
import { makeOperation, makeContext, resetSeq } from './helpers';
import type { SessionFocus } from '../../core/session/research-session';

function makeMockSession(focusOverrides?: Partial<SessionFocus>) {
  const focus: SessionFocus = {
    currentView: 'library' as const,
    activePapers: ['paper-1', 'paper-2'],
    activeConcepts: ['concept-1'],
    readerState: null,
    selected: {
      paperId: null,
      conceptId: null,
      noteId: null,
      articleId: null,
    },
    ...focusOverrides,
  };

  return { focus } as any;
}

function makeDeps(overrides?: Partial<ContextBuildDeps>): ContextBuildDeps {
  return {
    session: makeMockSession(),
    workspaceId: 'ws-test',
    ...overrides,
  };
}

describe('ContextSnapshotBuilder', () => {
  beforeEach(() => {
    resetSeq();
  });

  describe('build — budget policies', () => {
    it('uses standard budget by default', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation();
      const snapshot = await builder.build(op);

      expect(snapshot.budget.policy).toBe('standard');
      expect(snapshot.budget.includedLayers).toContain('surface');
      expect(snapshot.budget.includedLayers).toContain('working');
    });

    it('uses minimal budget when requested', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation({ constraints: { contextPolicy: 'minimal' } });
      const snapshot = await builder.build(op);

      expect(snapshot.budget.policy).toBe('minimal');
      expect(snapshot.budget.tokenBudget).toBe(2000);
      expect(snapshot.budget.includedLayers).toEqual(['surface']);
    });

    it('uses deep budget when requested', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation({ constraints: { contextPolicy: 'deep' } });
      const snapshot = await builder.build(op);

      expect(snapshot.budget.policy).toBe('deep');
      expect(snapshot.budget.tokenBudget).toBe(12000);
      expect(snapshot.budget.includedLayers).toContain('retrieval');
      expect(snapshot.budget.includedLayers).toContain('history');
    });
  });

  describe('build — selection resolution', () => {
    it('passes through existing operation selection', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation({
        context: makeContext({
          selection: { kind: 'editor', articleId: 'a', sectionId: 's', selectedText: 'hello', from: 0, to: 5 },
        }),
      });
      const snapshot = await builder.build(op);
      expect(snapshot.selection?.kind).toBe('editor');
    });

    it('infers reader selection from session focus', async () => {
      const session = makeMockSession({
        readerState: {
          paperId: 'p-1',
          page: 3,
          selection: { text: 'selected in pdf', page: 3 },
        },
      });
      const builder = new ContextSnapshotBuilder({ session, workspaceId: 'ws' });
      const op = makeOperation();
      // Clear operation-level selection so it falls through
      op.context = makeContext({ selection: null });
      const snapshot = await builder.build(op);

      expect(snapshot.selection?.kind).toBe('reader');
      if (snapshot.selection?.kind === 'reader') {
        expect(snapshot.selection.paperId).toBe('p-1');
        expect(snapshot.selection.selectedText).toBe('selected in pdf');
      }
    });

    it('returns null selection when neither available', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation();
      op.context = makeContext({ selection: null });
      const snapshot = await builder.build(op);
      expect(snapshot.selection).toBeNull();
    });
  });

  describe('build — focus entities', () => {
    it('preserves operation-level focus entities and active view', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation({
        context: makeContext({
          activeView: 'writing',
          focusEntities: { paperIds: ['paper-op'], conceptIds: ['concept-op'] },
        }),
      });

      const snapshot = await builder.build(op);

      expect(snapshot.activeView).toBe('writing');
      expect(snapshot.focusEntities).toEqual({ paperIds: ['paper-op'], conceptIds: ['concept-op'] });
    });

    it('extracts paper and concept ids from session focus', async () => {
      const session = makeMockSession({
        activePapers: ['p1', 'p2', 'p3'],
        activeConcepts: ['c1', 'c2'],
      });
      const builder = new ContextSnapshotBuilder({ session, workspaceId: 'ws' });
      const op = makeOperation();
      op.context = { ...op.context, focusEntities: undefined as any };
      const snapshot = await builder.build(op);

      expect(snapshot.focusEntities.paperIds).toEqual(['p1', 'p2', 'p3']);
      expect(snapshot.focusEntities.conceptIds).toEqual(['c1', 'c2']);
    });

    it('caps at 5 papers and 5 concepts', async () => {
      const session = makeMockSession({
        activePapers: Array.from({ length: 10 }, (_, i) => `p${i}`),
        activeConcepts: Array.from({ length: 10 }, (_, i) => `c${i}`),
      });
      const builder = new ContextSnapshotBuilder({ session, workspaceId: 'ws' });
      const op = makeOperation();
      op.context = { ...op.context, focusEntities: undefined as any };
      const snapshot = await builder.build(op);

      expect(snapshot.focusEntities.paperIds).toHaveLength(5);
      expect(snapshot.focusEntities.conceptIds).toHaveLength(5);
    });
  });

  describe('build — conversation resolution', () => {
    it('preserves operation conversation when present', async () => {
      const deps = makeDeps({
        getConversationTurns: vi.fn().mockReturnValue([{ role: 'user' as const, text: 'fallback' }]),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({
        context: makeContext({
          conversation: {
            recentTurns: [{ role: 'assistant', text: 'existing turn' }],
            currentGoal: 'keep focus',
          },
        }),
      });

      const snapshot = await builder.build(op);

      expect(snapshot.conversation).toEqual({
        recentTurns: [{ role: 'assistant', text: 'existing turn' }],
        currentGoal: 'keep focus',
      });
      expect(deps.getConversationTurns).not.toHaveBeenCalled();
    });

    it('includes conversation turns when working layer is active', async () => {
      const turns = [
        { role: 'user' as const, text: 'hello' },
        { role: 'assistant' as const, text: 'hi' },
      ];
      const deps = makeDeps({
        getConversationTurns: vi.fn().mockReturnValue(turns),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const snapshot = await builder.build(makeOperation());

      expect(snapshot.conversation.recentTurns).toHaveLength(2);
      expect(deps.getConversationTurns).toHaveBeenCalled();
    });

    it('excludes conversation for minimal budget', async () => {
      const deps = makeDeps({
        getConversationTurns: vi.fn().mockReturnValue([]),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({ constraints: { contextPolicy: 'minimal' } });
      const snapshot = await builder.build(op);

      expect(snapshot.conversation.recentTurns).toEqual([]);
      expect(deps.getConversationTurns).not.toHaveBeenCalled();
    });

    it('requests more turns for deep budget (history layer)', async () => {
      const deps = makeDeps({
        getConversationTurns: vi.fn().mockReturnValue([]),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({ constraints: { contextPolicy: 'deep' } });
      await builder.build(op);

      // Deep budget includes 'history' layer → limit=20
      expect(deps.getConversationTurns).toHaveBeenCalledWith(expect.any(String), 20);
    });
  });

  describe('build — retrieval context', () => {
    it('preserves operation retrieval when present', async () => {
      const deps = makeDeps({
        getRetrievalContext: vi.fn().mockReturnValue({ evidence: [{ chunkId: 'fallback', paperId: 'p', text: 'fallback', score: 0.1 }] }),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({
        context: makeContext({
          retrieval: {
            evidence: [{ chunkId: 'op-chunk', paperId: 'paper-1', text: 'existing evidence', score: 0.9 }],
            lastQuery: 'operation query',
          },
        }),
      });

      const snapshot = await builder.build(op);

      expect(snapshot.retrieval).toEqual({
        evidence: [{ chunkId: 'op-chunk', paperId: 'paper-1', text: 'existing evidence', score: 0.9 }],
        lastQuery: 'operation query',
      });
      expect(deps.getRetrievalContext).not.toHaveBeenCalled();
    });

    it('includes retrieval for deep budget', async () => {
      const deps = makeDeps({
        getRetrievalContext: vi.fn().mockReturnValue({
          evidence: [{ chunkId: 'c1', paperId: 'p1', text: 'evidence', score: 0.9 }],
        }),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({ constraints: { contextPolicy: 'deep' } });
      const snapshot = await builder.build(op);

      expect(snapshot.retrieval.evidence).toHaveLength(1);
    });

    it('excludes retrieval for standard budget', async () => {
      const deps = makeDeps({
        getRetrievalContext: vi.fn(),
      });
      const builder = new ContextSnapshotBuilder(deps);
      const snapshot = await builder.build(makeOperation());

      expect(snapshot.retrieval.evidence).toEqual([]);
      expect(deps.getRetrievalContext).not.toHaveBeenCalled();
    });
  });

  describe('build — article focus', () => {
    it('fetches article focus when available', async () => {
      const session = makeMockSession({ selected: { paperId: null, conceptId: null, noteId: null, articleId: 'art-1' } });
      const deps: ContextBuildDeps = {
        session,
        workspaceId: 'ws',
        getArticleFocus: vi.fn().mockResolvedValue({
          articleId: 'art-1',
          sectionId: 'sec-1',
          articleTitle: 'Test Article',
        }),
      };
      const builder = new ContextSnapshotBuilder(deps);
      const snapshot = await builder.build(makeOperation());

      expect(snapshot.article?.articleId).toBe('art-1');
    });

    it('merges fetched article focus with operation-provided section context', async () => {
      const deps: ContextBuildDeps = {
        session: makeMockSession(),
        workspaceId: 'ws',
        getArticleFocus: vi.fn().mockResolvedValue({
          articleId: 'art-1',
          sectionId: 'sec-db',
          articleTitle: 'DB Title',
          nextSectionTitles: ['DB Next'],
        }),
      };
      const builder = new ContextSnapshotBuilder(deps);
      const op = makeOperation({
        context: makeContext({
          article: {
            articleId: 'art-1',
            sectionId: 'sec-op',
            sectionTitle: 'Operation Section',
            previousSectionSummaries: ['Prev from op'],
          },
        }),
      });

      const snapshot = await builder.build(op);

      expect(snapshot.article).toEqual({
        articleId: 'art-1',
        sectionId: 'sec-op',
        articleTitle: 'DB Title',
        sectionTitle: 'Operation Section',
        previousSectionSummaries: ['Prev from op'],
        nextSectionTitles: ['DB Next'],
      });
    });
  });

  describe('build — writing context', () => {
    it('passes through existing writing context', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const op = makeOperation({
        context: makeContext({
          writing: { editorId: 'main', articleId: 'a', sectionId: null, unsavedChanges: true },
        }),
      });
      const snapshot = await builder.build(op);
      expect(snapshot.writing?.unsavedChanges).toBe(true);
    });

    it('infers writing context from view and article focus', async () => {
      const session = makeMockSession({
        currentView: 'writing' as const,
        selected: { paperId: null, conceptId: null, noteId: null, articleId: 'art-1' },
      });
      const builder = new ContextSnapshotBuilder({ session, workspaceId: 'ws' });
      const op = makeOperation();
      op.context = makeContext({ writing: null });
      const snapshot = await builder.build(op);

      expect(snapshot.writing?.articleId).toBe('art-1');
    });
  });

  describe('build — frozenAt timestamp', () => {
    it('sets frozenAt to current time', async () => {
      const before = Date.now();
      const builder = new ContextSnapshotBuilder(makeDeps());
      const snapshot = await builder.build(makeOperation());
      expect(snapshot.frozenAt).toBeGreaterThanOrEqual(before);
      expect(snapshot.frozenAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('build — immutability', () => {
    it('returns a frozen snapshot', async () => {
      const builder = new ContextSnapshotBuilder(makeDeps());
      const snapshot = await builder.build(makeOperation());
      expect(Object.isFrozen(snapshot)).toBe(true);
    });
  });
});
