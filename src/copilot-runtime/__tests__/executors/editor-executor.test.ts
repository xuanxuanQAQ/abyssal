import { EditorExecutor } from '../../executors/editor-executor';
import type { EditorExecutorDeps } from '../../executors/editor-executor';
import { OperationEventEmitter } from '../../event-emitter';
import { makeOperation, resetSeq } from '../helpers';
import type { EditorPatch } from '../../types';

function makePatch(overrides?: Partial<EditorPatch>): EditorPatch {
  return {
    kind: 'replace-range',
    editorId: 'main',
    from: 0,
    to: 5,
    content: { type: 'doc', content: [{ type: 'text', text: 'new' }] },
    preconditions: {
      articleId: 'art-1',
      sectionId: 'sec-1',
      editorId: 'main',
      expectedSelection: { from: 0, to: 5 },
    },
    ...overrides,
  } as EditorPatch;
}

describe('EditorExecutor', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    resetSeq();
  });

  describe('execute — successful patch', () => {
    it('applies patch and returns applied=true', async () => {
      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new EditorExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(result.applied).toBe(true);
      expect(deps.reconcile).toHaveBeenCalled();
      expect(deps.applyPatch).toHaveBeenCalled();
    });

    it('emits patch.proposed and patch.applied events', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new EditorExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(events.some((e) => e.type === 'patch.proposed')).toBe(true);
      expect(events.some((e) => e.type === 'patch.applied')).toBe(true);
    });
  });

  describe('execute — reconciliation failure', () => {
    it('returns applied=false when reconciliation fails', async () => {
      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'selection_shifted',
          fallbackTarget: { type: 'chat-message' },
        }),
        applyPatch: vi.fn(),
      };
      const executor = new EditorExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(result.applied).toBe(false);
      expect(result.reconciliation.reason).toBe('selection_shifted');
      expect(result.fallbackTarget?.type).toBe('chat-message');
      expect(deps.applyPatch).not.toHaveBeenCalled();
    });
  });

  describe('execute — apply failure', () => {
    it('returns applied=false when applyPatch throws', async () => {
      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockRejectedValue(new Error('transaction failed')),
      };
      const executor = new EditorExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(result.applied).toBe(false);
      expect(result.reconciliation.ok).toBe(false);
    });
  });

  describe('execute — persistence', () => {
    it('calls persistDocument after successful apply', async () => {
      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockResolvedValue(undefined),
        persistDocument: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new EditorExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(deps.persistDocument).toHaveBeenCalledWith('art-1', 'sec-1');
    });

    it('emits persistence.succeeded on successful persist', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockResolvedValue(undefined),
        persistDocument: vi.fn().mockResolvedValue(undefined),
      };
      const executor = new EditorExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      expect(events.some((e) => e.type === 'persistence.succeeded')).toBe(true);
    });

    it('emits persistence.failed when persist throws', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps: EditorExecutorDeps = {
        reconcile: vi.fn().mockResolvedValue({ ok: true }),
        applyPatch: vi.fn().mockResolvedValue(undefined),
        persistDocument: vi.fn().mockRejectedValue(new Error('disk full')),
      };
      const executor = new EditorExecutor(deps);
      const result = await executor.execute(makeOperation({ id: 'op-1' }), makePatch(), emitter);

      // Patch itself was applied successfully
      expect(result.applied).toBe(true);
      expect(events.some((e) => e.type === 'persistence.failed')).toBe(true);
    });
  });
});
