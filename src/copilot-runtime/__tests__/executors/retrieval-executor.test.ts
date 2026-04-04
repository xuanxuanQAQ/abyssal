import { RetrievalExecutor } from '../../executors/retrieval-executor';
import type { RetrievalExecutorDeps } from '../../executors/retrieval-executor';
import { OperationEventEmitter } from '../../event-emitter';
import { makeOperation, resetSeq } from '../helpers';
import type { ExecutionStep } from '../../types';

function makeStep(query = 'test query'): ExecutionStep & { kind: 'retrieve' } {
  return { kind: 'retrieve', query, source: 'rag' };
}

describe('RetrievalExecutor', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
    resetSeq();
  });

  describe('execute — success', () => {
    it('returns evidence from ragSearch', async () => {
      const deps: RetrievalExecutorDeps = {
        ragSearch: vi.fn().mockResolvedValue([
          { chunkId: 'c1', paperId: 'p1', text: 'evidence text', score: 0.95 },
          { chunkId: 'c2', paperId: 'p2', text: 'more evidence', score: 0.8 },
        ]),
      };
      const executor = new RetrievalExecutor(deps);
      const op = makeOperation({ id: 'op-1' });

      const result = await executor.execute(op, makeStep('my query'), emitter);

      expect(result.evidence).toHaveLength(2);
      expect(result.query).toBe('my query');
      expect(deps.ragSearch).toHaveBeenCalledWith('my query', 10);
    });

    it('emits retrieval.started and retrieval.finished events', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps: RetrievalExecutorDeps = {
        ragSearch: vi.fn().mockResolvedValue([]),
      };
      const executor = new RetrievalExecutor(deps);
      await executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter);

      expect(events.some((e) => e.type === 'retrieval.started')).toBe(true);
      expect(events.some((e) => e.type === 'retrieval.finished')).toBe(true);
    });
  });

  describe('execute — aborted', () => {
    it('returns empty evidence when aborted', async () => {
      const deps: RetrievalExecutorDeps = {
        ragSearch: vi.fn(),
      };
      const executor = new RetrievalExecutor(deps);
      const controller = new AbortController();
      controller.abort();

      const result = await executor.execute(
        makeOperation({ id: 'op-1' }),
        makeStep(),
        emitter,
        controller.signal,
      );

      expect(result.evidence).toEqual([]);
      expect(deps.ragSearch).not.toHaveBeenCalled();
    });
  });

  describe('execute — error', () => {
    it('emits retrieval.finished with count 0 then throws', async () => {
      const events: any[] = [];
      emitter.on((e) => events.push(e));

      const deps: RetrievalExecutorDeps = {
        ragSearch: vi.fn().mockRejectedValue(new Error('search failed')),
      };
      const executor = new RetrievalExecutor(deps);

      await expect(executor.execute(makeOperation({ id: 'op-1' }), makeStep(), emitter))
        .rejects.toThrow('search failed');

      const finished = events.find((e) => e.type === 'retrieval.finished');
      expect(finished?.evidenceCount).toBe(0);
    });
  });
});
