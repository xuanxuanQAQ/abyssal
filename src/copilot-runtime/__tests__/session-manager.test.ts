import { CopilotSessionManager } from '../session-manager';
import { makeOperation, resetSeq } from './helpers';
import type { CopilotOperationEvent } from '../types';

function makeEvent(overrides: Partial<CopilotOperationEvent> & { operationId: string; type: CopilotOperationEvent['type'] }): CopilotOperationEvent {
  return {
    sequence: 1,
    emittedAt: Date.now(),
    ...overrides,
  } as CopilotOperationEvent;
}

describe('CopilotSessionManager', () => {
  let manager: CopilotSessionManager;

  beforeEach(() => {
    manager = new CopilotSessionManager();
    resetSeq();
  });

  describe('getOrCreate', () => {
    it('creates new session on first call', () => {
      const session = manager.getOrCreate('s1', 'Test Session');
      expect(session.id).toBe('s1');
      expect(session.title).toBe('Test Session');
      expect(session.timeline).toEqual([]);
    });

    it('returns existing session on subsequent calls', () => {
      manager.getOrCreate('s1', 'First');
      const session = manager.getOrCreate('s1', 'Second');
      expect(session.title).toBe('First'); // not overwritten
    });
  });

  describe('get', () => {
    it('returns null for non-existent sessions', () => {
      expect(manager.get('nonexistent')).toBeNull();
    });

    it('returns session after creation', () => {
      manager.getOrCreate('s1');
      expect(manager.get('s1')).not.toBeNull();
    });
  });

  describe('list', () => {
    it('lists all sessions as summaries', () => {
      manager.getOrCreate('s1', 'A');
      manager.getOrCreate('s2', 'B');
      const summaries = manager.list();
      expect(summaries).toHaveLength(2);
      expect(summaries.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    });
  });

  describe('clear', () => {
    it('removes session and its operation mappings', () => {
      manager.getOrCreate('s1');
      manager.clear('s1');
      expect(manager.get('s1')).toBeNull();
    });
  });

  describe('trackOperation + appendEvent', () => {
    it('tracks operation and appends events to timeline', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      const event = makeEvent({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' } as any);
      manager.appendEvent(event);

      const session = manager.get('s1')!;
      expect(session.timeline).toHaveLength(1);
    });

    it('sets activeOperationId during tracking', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      const session = manager.get('s1')!;
      expect(session.activeOperationId).toBe('op-1');
    });
  });

  describe('terminal state tracking', () => {
    it('marks operation as completed on operation.completed event', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      manager.appendEvent(makeEvent({ operationId: 'op-1', type: 'operation.completed' }));

      expect(manager.isTerminal('op-1')).toBe(true);
      expect(manager.getTerminalState('op-1')?.terminalStatus).toBe('completed');
    });

    it('marks operation as failed on operation.failed event', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      manager.appendEvent(makeEvent({
        operationId: 'op-1',
        type: 'operation.failed',
        code: 'ERR',
        message: 'boom',
      } as any));

      expect(manager.isTerminal('op-1')).toBe(true);
      expect(manager.getTerminalState('op-1')?.terminalStatus).toBe('failed');
    });

    it('marks operation as aborted on operation.aborted event', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      manager.appendEvent(makeEvent({
        operationId: 'op-1',
        type: 'operation.aborted',
        reason: 'user_cancel',
      } as any));

      expect(manager.isTerminal('op-1')).toBe(true);
      expect(manager.getTerminalState('op-1')?.terminalStatus).toBe('aborted');
    });

    it('clears activeOperationId on terminal event', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      manager.appendEvent(makeEvent({ operationId: 'op-1', type: 'operation.completed' }));

      const session = manager.get('s1')!;
      expect(session.activeOperationId).toBeUndefined();
    });
  });

  describe('pendingClarification', () => {
    it('sets and clears pending clarification', () => {
      manager.getOrCreate('s1');
      manager.setPendingClarification('s1', {
        operationId: 'op-1',
        sessionId: 's1',
        question: 'Which one?',
        options: [{ id: 'a', label: 'Option A' }],
        resumeOperation: makeOperation({ id: 'op-1', sessionId: 's1' }),
        continuationToken: 'tok-1',
      });

      const session = manager.get('s1')!;
      expect(session.pendingClarification?.question).toBe('Which one?');

      manager.clearPendingClarification('s1');
      expect(manager.get('s1')!.pendingClarification).toBeUndefined();
    });
  });

  describe('getOperationStatus', () => {
    it('returns null for unknown operations', () => {
      expect(manager.getOperationStatus('unknown')).toBeNull();
    });

    it('returns running status for active operations', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);

      const status = manager.getOperationStatus('op-1');
      expect(status?.status).toBe('running');
    });

    it('returns clarification_required when pending', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);
      manager.setPendingClarification('s1', {
        operationId: 'op-1',
        sessionId: 's1',
        question: 'Which?',
        options: [],
        resumeOperation: op,
        continuationToken: 'tok',
      });

      const status = manager.getOperationStatus('op-1');
      expect(status?.status).toBe('clarification_required');
    });

    it('returns terminal status after completion', () => {
      const op = makeOperation({ id: 'op-1', sessionId: 's1' });
      manager.getOrCreate('s1');
      manager.trackOperation(op);
      manager.appendEvent(makeEvent({ operationId: 'op-1', type: 'operation.completed' }));

      const status = manager.getOperationStatus('op-1');
      expect(status?.status).toBe('completed');
    });
  });

  describe('session eviction', () => {
    it('evicts oldest sessions when exceeding max', () => {
      // Create 51 sessions — the oldest should be evicted
      for (let i = 0; i < 51; i++) {
        const session = manager.getOrCreate(`s-${i}`);
        // Add a timeline event so they have different timestamps
        if (i === 0) {
          // Mark the first one as the oldest
          session.timeline.push(makeEvent({
            operationId: `op-${i}`,
            type: 'operation.started',
            sessionId: `s-${i}`,
            intent: 'ask',
            emittedAt: 1000, // very old
          } as any));
        }
      }

      const summaries = manager.list();
      expect(summaries.length).toBeLessThanOrEqual(50);
    });
  });
});
