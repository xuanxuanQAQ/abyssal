import { OperationEventEmitter } from '../event-emitter';
import type { CopilotEventPayload } from '../event-emitter';

describe('OperationEventEmitter', () => {
  let emitter: OperationEventEmitter;

  beforeEach(() => {
    emitter = new OperationEventEmitter();
  });

  describe('emit — sequence numbering', () => {
    it('auto-increments sequence per operation', () => {
      const e1 = emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      const e2 = emitter.emit({ operationId: 'op-1', type: 'context.resolved', summary: 'ok' });
      const e3 = emitter.emit({ operationId: 'op-1', type: 'operation.completed' });

      expect(e1.sequence).toBe(1);
      expect(e2.sequence).toBe(2);
      expect(e3.sequence).toBe(3);
    });

    it('tracks sequences independently per operation', () => {
      const e1 = emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      const e2 = emitter.emit({ operationId: 'op-2', type: 'operation.started', sessionId: 's2', intent: 'ask' });
      const e3 = emitter.emit({ operationId: 'op-1', type: 'operation.completed' });

      expect(e1.sequence).toBe(1);
      expect(e2.sequence).toBe(1);
      expect(e3.sequence).toBe(2);
    });
  });

  describe('emit — timestamps', () => {
    it('adds emittedAt timestamp', () => {
      const before = Date.now();
      const e = emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      expect(e.emittedAt).toBeGreaterThanOrEqual(before);
      expect(e.emittedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('on / listener notification', () => {
    it('notifies registered listeners', () => {
      const received: unknown[] = [];
      emitter.on((event) => received.push(event));

      emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      expect(received).toHaveLength(1);
    });

    it('returns unsubscribe function', () => {
      const received: unknown[] = [];
      const unsub = emitter.on((event) => received.push(event));

      emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      unsub();
      emitter.emit({ operationId: 'op-1', type: 'operation.completed' });

      expect(received).toHaveLength(1);
    });

    it('swallows listener errors without breaking main chain', () => {
      const received: unknown[] = [];
      emitter.on(() => { throw new Error('boom'); });
      emitter.on((event) => received.push(event));

      const e = emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      expect(e.sequence).toBe(1);
      expect(received).toHaveLength(1);
    });
  });

  describe('releaseOperation', () => {
    it('resets sequence counter for released operation', () => {
      emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      emitter.emit({ operationId: 'op-1', type: 'operation.completed' });
      emitter.releaseOperation('op-1');

      const e = emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });
      expect(e.sequence).toBe(1); // reset
    });
  });

  describe('removeAllListeners', () => {
    it('clears all listeners and sequence counters', () => {
      const received: unknown[] = [];
      emitter.on((event) => received.push(event));
      emitter.emit({ operationId: 'op-1', type: 'operation.started', sessionId: 's1', intent: 'ask' });

      emitter.removeAllListeners();
      emitter.emit({ operationId: 'op-1', type: 'operation.completed' });

      expect(received).toHaveLength(1); // only the first event
    });
  });

  describe('emit — preserves discriminated union type', () => {
    it('correctly handles model.delta events', () => {
      const e = emitter.emit({
        operationId: 'op-1',
        type: 'model.delta',
        channel: 'chat',
        text: 'hello',
      });
      expect(e.type).toBe('model.delta');
      expect((e as { text: string }).text).toBe('hello');
    });

    it('correctly handles tool.call events', () => {
      const e = emitter.emit({
        operationId: 'op-1',
        type: 'tool.call',
        toolName: 'search',
        status: 'completed',
      });
      expect(e.type).toBe('tool.call');
    });
  });
});
