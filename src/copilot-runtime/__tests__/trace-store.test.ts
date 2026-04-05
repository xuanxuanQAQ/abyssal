import { TraceStore } from '../trace-store';

describe('TraceStore', () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore();
  });

  describe('createTrace', () => {
    it('creates a trace with operationId and sessionId', () => {
      const trace = store.createTrace('op-1', 'sess-1');
      expect(trace.operationId).toBe('op-1');
      expect(trace.sessionId).toBe('sess-1');
      expect(trace.phases).toEqual([]);
      expect(trace.startedAt).toBeGreaterThan(0);
    });
  });

  describe('getTrace', () => {
    it('returns created trace', () => {
      store.createTrace('op-1', 'sess-1');
      expect(store.getTrace('op-1')).toBeDefined();
    });

    it('returns undefined for unknown operations', () => {
      expect(store.getTrace('nonexistent')).toBeUndefined();
    });
  });

  describe('phase lifecycle', () => {
    it('tracks phase start → complete', () => {
      store.createTrace('op-1', 'sess-1');
      store.startPhase('op-1', 'normalize');
      store.completePhase('op-1', 'normalize', { matched: true });

      const trace = store.getTrace('op-1')!;
      expect(trace.phases).toHaveLength(1);
      expect(trace.phases[0]!.name).toBe('normalize');
      expect(trace.phases[0]!.status).toBe('completed');
      expect(trace.phases[0]!.finishedAt).toBeGreaterThan(0);
      expect(trace.phases[0]!.detail).toEqual({ matched: true });
    });

    it('tracks phase start → fail', () => {
      store.createTrace('op-1', 'sess-1');
      store.startPhase('op-1', 'execute');
      store.failPhase('op-1', 'execute', { code: 'ERR', message: 'timeout' });

      const trace = store.getTrace('op-1')!;
      expect(trace.phases[0]!.status).toBe('failed');
      expect(trace.phases[0]!.error?.code).toBe('ERR');
    });

    it('handles multiple phases', () => {
      store.createTrace('op-1', 'sess-1');
      store.startPhase('op-1', 'normalize');
      store.completePhase('op-1', 'normalize');
      store.startPhase('op-1', 'recipe');
      store.completePhase('op-1', 'recipe');
      store.startPhase('op-1', 'execute');
      store.failPhase('op-1', 'execute', { code: 'E', message: 'err' });

      const trace = store.getTrace('op-1')!;
      expect(trace.phases).toHaveLength(3);
      expect(trace.phases[2]!.status).toBe('failed');
    });
  });

  describe('addDegradation', () => {
    it('appends degradation records', () => {
      store.createTrace('op-1', 'sess-1');
      store.addDegradation('op-1', {
        stage: 'retrieval',
        mode: 'fallback_to_plain_draft',
        reason: 'empty results',
      });

      const trace = store.getTrace('op-1')!;
      expect(trace.degradations).toHaveLength(1);
      expect(trace.degradations![0]!.mode).toBe('fallback_to_plain_draft');
    });
  });

  describe('finalizeTrace', () => {
    it('creates a summary and sets finishedAt', () => {
      store.createTrace('op-1', 'sess-1');
      store.finalizeTrace('op-1', 'completed', 'ask', 'chat', 'recipe-ask');

      const trace = store.getTrace('op-1')!;
      expect(trace.finishedAt).toBeGreaterThan(0);

      const summaries = store.getSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.operationId).toBe('op-1');
      expect(summaries[0]!.status).toBe('completed');
      expect(summaries[0]!.recipeId).toBe('recipe-ask');
    });

    it('calculates durationMs', () => {
      store.createTrace('op-1', 'sess-1');
      store.finalizeTrace('op-1', 'completed', 'ask', 'chat');

      const summaries = store.getSummaries();
      expect(summaries[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ring buffer (MAX_MEMORY_TRACES = 50)', () => {
    it('evicts oldest traces when exceeding 50', () => {
      for (let i = 0; i < 55; i++) {
        store.createTrace(`op-${i}`, 'sess-1');
      }

      // Oldest 5 should be evicted
      expect(store.getTrace('op-0')).toBeUndefined();
      expect(store.getTrace('op-4')).toBeUndefined();
      expect(store.getTrace('op-5')).toBeDefined();
      expect(store.getTrace('op-54')).toBeDefined();
    });
  });

  describe('getRecentTraces', () => {
    it('returns last N traces', () => {
      for (let i = 0; i < 5; i++) {
        store.createTrace(`op-${i}`, 'sess-1');
      }

      const recent = store.getRecentTraces(3);
      expect(recent).toHaveLength(3);
      expect(recent[0]!.operationId).toBe('op-2');
    });
  });

  describe('getSummaries', () => {
    it('returns last N summaries', () => {
      for (let i = 0; i < 5; i++) {
        store.createTrace(`op-${i}`, 'sess-1');
        store.finalizeTrace(`op-${i}`, 'completed', 'ask', 'chat');
      }

      const summaries = store.getSummaries(2);
      expect(summaries).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('removes all traces and summaries', () => {
      store.createTrace('op-1', 'sess-1');
      store.finalizeTrace('op-1', 'completed', 'ask', 'chat');
      store.clear();

      expect(store.getTrace('op-1')).toBeUndefined();
      expect(store.getSummaries()).toEqual([]);
      expect(store.getRecentTraces()).toEqual([]);
    });
  });
});
