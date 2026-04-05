import { EventBus } from './event-bus';
import type { AppEvent, AppEventType } from './event-types';

// Helper to create a minimal valid event
function makeEvent(type: AppEventType, extra: Record<string, unknown> = {}): AppEvent {
  switch (type) {
    case 'user:navigate':
      return { type, view: 'library', previousView: 'reader', ...extra } as any;
    case 'user:selectPaper':
      return { type, paperId: 'p1', source: 'library', ...extra } as any;
    case 'data:paperAdded':
      return { type, paperId: 'p1', title: 'Test', source: 'import', ...extra } as any;
    case 'pipeline:complete':
      return { type, taskId: 't1', workflow: 'analyze', result: 'completed', ...extra } as any;
    default:
      return { type, ...extra } as any;
  }
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  // ── Subscribe / Emit ──

  describe('on + emit', () => {
    it('delivers event to type-specific listener', async () => {
      const events: AppEvent[] = [];
      bus.on('user:navigate', (e) => { events.push(e); });

      await bus.emit(makeEvent('user:navigate'));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('user:navigate');
    });

    it('does not deliver events of other types', async () => {
      const events: AppEvent[] = [];
      bus.on('user:navigate', (e) => { events.push(e); });

      await bus.emit(makeEvent('user:selectPaper'));
      expect(events).toHaveLength(0);
    });

    it('delivers to multiple listeners on same type', async () => {
      let count = 0;
      bus.on('user:navigate', () => { count++; });
      bus.on('user:navigate', () => { count++; });

      await bus.emit(makeEvent('user:navigate'));
      expect(count).toBe(2);
    });
  });

  // ── Wildcard ──

  describe('onAny', () => {
    it('receives all event types', async () => {
      const events: AppEvent[] = [];
      bus.onAny((e) => { events.push(e); });

      await bus.emit(makeEvent('user:navigate'));
      await bus.emit(makeEvent('data:paperAdded'));
      expect(events).toHaveLength(2);
    });
  });

  // ── Once ──

  describe('once', () => {
    it('auto-unsubscribes after first event', async () => {
      let count = 0;
      bus.once('user:navigate', () => { count++; });

      await bus.emit(makeEvent('user:navigate'));
      await bus.emit(makeEvent('user:navigate'));
      expect(count).toBe(1);
    });
  });

  // ── Unsubscribe ──

  describe('unsubscribe', () => {
    it('stops receiving events after unsubscribe', async () => {
      let count = 0;
      const handle = bus.on('user:navigate', () => { count++; });

      await bus.emit(makeEvent('user:navigate'));
      expect(count).toBe(1);

      handle.unsubscribe();
      await bus.emit(makeEvent('user:navigate'));
      expect(count).toBe(1);
    });

    it('wildcard unsubscribe works', async () => {
      let count = 0;
      const handle = bus.onAny(() => { count++; });

      await bus.emit(makeEvent('user:navigate'));
      handle.unsubscribe();
      await bus.emit(makeEvent('user:navigate'));
      expect(count).toBe(1);
    });
  });

  // ── waitFor ──

  describe('waitFor', () => {
    it('resolves when matching event is emitted', async () => {
      const promise = bus.waitFor('data:paperAdded');
      await bus.emit(makeEvent('data:paperAdded'));
      const event = await promise;
      expect(event.type).toBe('data:paperAdded');
    });

    it('rejects on timeout', async () => {
      vi.useFakeTimers();
      const promise = bus.waitFor('data:paperAdded', 100);
      vi.advanceTimersByTime(150);
      await expect(promise).rejects.toThrow('timed out');
      vi.useRealTimers();
    });

    it('supports predicate filter', async () => {
      const promise = bus.waitFor('user:selectPaper', 0, (e) => e.paperId === 'p2');

      // First emit doesn't match predicate
      await bus.emit(makeEvent('user:selectPaper', { paperId: 'p1' }));

      // Second emit matches
      await bus.emit(makeEvent('user:selectPaper', { paperId: 'p2' }) as any);
      const event = await promise;
      expect((event as any).paperId).toBe('p2');
    });
  });

  // ── History ──

  describe('history', () => {
    it('records emitted events in order', async () => {
      await bus.emit(makeEvent('user:navigate'));
      await bus.emit(makeEvent('data:paperAdded'));
      const history = bus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.type).toBe('user:navigate');
      expect(history[1]!.type).toBe('data:paperAdded');
    });

    it('respects historySize limit', async () => {
      const smallBus = new EventBus({ historySize: 3 });
      for (let i = 0; i < 5; i++) {
        await smallBus.emit(makeEvent('user:navigate'));
      }
      expect(smallBus.getHistory()).toHaveLength(3);
      smallBus.destroy();
    });

    it('filters by type', async () => {
      await bus.emit(makeEvent('user:navigate'));
      await bus.emit(makeEvent('data:paperAdded'));
      await bus.emit(makeEvent('user:navigate'));
      const filtered = bus.getHistory({ type: 'user:navigate' });
      expect(filtered).toHaveLength(2);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) await bus.emit(makeEvent('user:navigate'));
      const limited = bus.getHistory({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('getLatest returns most recent of type', async () => {
      await bus.emit(makeEvent('user:navigate', { view: 'library' }) as any);
      await bus.emit(makeEvent('user:navigate', { view: 'reader' }) as any);
      const latest = bus.getLatest('user:navigate');
      expect((latest as any)?.view).toBe('reader');
    });

    it('getLatest returns null when no events of type', () => {
      expect(bus.getLatest('user:navigate')).toBeNull();
    });

    it('clearHistory empties history', async () => {
      await bus.emit(makeEvent('user:navigate'));
      bus.clearHistory();
      expect(bus.getHistory()).toHaveLength(0);
    });
  });

  // ── Middleware ──

  describe('middleware', () => {
    it('middleware can observe events', async () => {
      const observed: string[] = [];
      bus.use((event, next) => {
        observed.push(event.type);
        next();
      });

      await bus.emit(makeEvent('user:navigate'));
      expect(observed).toEqual(['user:navigate']);
    });

    it('middleware can swallow events by not calling next()', async () => {
      let listenerCalled = false;
      bus.use((_event, _next) => {
        // Don't call next — swallow
      });
      bus.on('user:navigate', () => { listenerCalled = true; });

      await bus.emit(makeEvent('user:navigate'));
      expect(listenerCalled).toBe(false);
    });

    it('multiple middlewares run in order', async () => {
      const order: number[] = [];
      bus.use((_event, next) => { order.push(1); next(); });
      bus.use((_event, next) => { order.push(2); next(); });

      await bus.emit(makeEvent('user:navigate'));
      expect(order).toEqual([1, 2]);
    });
  });

  // ── Pause / Resume ──

  describe('pause / resume', () => {
    it('queues events while paused and flushes on resume', async () => {
      const events: AppEvent[] = [];
      bus.on('user:navigate', (e) => { events.push(e); });

      bus.pause();
      await bus.emit(makeEvent('user:navigate'));
      expect(events).toHaveLength(0);

      await bus.resume();
      expect(events).toHaveLength(1);
    });

    it('drops oldest events when pause queue overflows (MAX_PAUSE_QUEUE=500)', async () => {
      bus.pause();
      for (let i = 0; i < 600; i++) {
        await bus.emit(makeEvent('user:navigate'));
      }
      const events: AppEvent[] = [];
      bus.on('user:navigate', (e) => { events.push(e); });
      await bus.resume();
      // Should have at most MAX_PAUSE_QUEUE (500) events
      expect(events.length).toBeLessThanOrEqual(500);
    });
  });

  // ── Error isolation ──

  describe('error isolation', () => {
    it('catches listener errors without crashing', async () => {
      bus.on('user:navigate', () => { throw new Error('boom'); });
      const events: AppEvent[] = [];
      bus.on('user:navigate', (e) => { events.push(e); });

      // Should not throw
      await bus.emit(makeEvent('user:navigate'));
      // Second listener should still fire
      expect(events).toHaveLength(1);
    });
  });

  // ── Cleanup ──

  describe('destroy', () => {
    it('removes all listeners and empties history', async () => {
      bus.on('user:navigate', () => {});
      bus.onAny(() => {});
      await bus.emit(makeEvent('user:navigate'));

      bus.destroy();
      expect(bus.listenerCount).toBe(0);
      expect(bus.getHistory()).toHaveLength(0);
    });
  });

  // ── removeAllListeners ──

  describe('removeAllListeners', () => {
    it('removes listeners for specific type', async () => {
      let count = 0;
      bus.on('user:navigate', () => { count++; });
      bus.on('data:paperAdded', () => { count++; });

      bus.removeAllListeners('user:navigate');
      await bus.emit(makeEvent('user:navigate'));
      await bus.emit(makeEvent('data:paperAdded'));
      expect(count).toBe(1);
    });

    it('removes all when no type specified', () => {
      bus.on('user:navigate', () => {});
      bus.onAny(() => {});
      bus.removeAllListeners();
      expect(bus.listenerCount).toBe(0);
    });
  });
});
