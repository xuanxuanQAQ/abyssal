/**
 * Robustness tests — IPC push channel behavior under adverse conditions.
 *
 * Tests: disconnected window, large payloads, db-change merging,
 * workflow throttle, and push ordering.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PushManager } from '../../../src/electron/ipc/push';

function makeMockWindow() {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: {
      send: vi.fn(),
    },
  };
}

function makeDestroyedWindow() {
  return {
    isDestroyed: vi.fn().mockReturnValue(true),
    webContents: {
      send: vi.fn(),
    },
  };
}

describe('PushManager robustness — disconnected window', () => {
  let pm: PushManager;

  beforeEach(() => {
    vi.useFakeTimers();
    pm = new PushManager();
  });

  afterEach(() => {
    pm.destroy();
    vi.useRealTimers();
  });

  it('silently drops push when no window is set', () => {
    expect(() => {
      pm.pushNotification({ type: 'info', title: 'test', message: 'msg' });
    }).not.toThrow();
  });

  it('silently drops push when window is destroyed', () => {
    const win = makeDestroyedWindow();
    pm.setWindow(win as any);

    expect(() => {
      pm.pushNotification({ type: 'info', title: 'test', message: 'msg' });
    }).not.toThrow();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('recovers when window is set after being null', () => {
    pm.pushNotification({ type: 'info', title: 'test', message: 'dropped' });

    const win = makeMockWindow();
    pm.setWindow(win as any);
    pm.pushNotification({ type: 'info', title: 'test', message: 'received' });

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });
});

describe('PushManager robustness — db-change debounce merging', () => {
  let pm: PushManager;
  let win: ReturnType<typeof makeMockWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    pm = new PushManager();
    win = makeMockWindow();
    pm.setWindow(win as any);
  });

  afterEach(() => {
    pm.destroy();
    vi.useRealTimers();
  });

  it('merges multiple db-change events within 100ms window', () => {
    pm.enqueueDbChange(['papers'], 'insert', { papers: ['p1'] });
    pm.enqueueDbChange(['concepts'], 'update', { concepts: ['c1'] });
    pm.enqueueDbChange(['papers'], 'update', { papers: ['p2'] });

    vi.advanceTimersByTime(100);

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    const [channel, data] = win.webContents.send.mock.calls[0]!;
    expect(channel).toBe('push:dbChanged');
    expect(data.tables).toContain('papers');
    expect(data.tables).toContain('concepts');
    expect(data.operations).toContain('insert');
    expect(data.operations).toContain('update');
    expect(data.affectedIds.papers).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('caps affected IDs at 50 and signals full refetch', () => {
    const manyIds = Array.from({ length: 55 }, (_, i) => `p${i}`);
    pm.enqueueDbChange(['papers'], 'update', { papers: manyIds });

    vi.advanceTimersByTime(100);

    const [, data] = win.webContents.send.mock.calls[0]!;
    expect(data.affectedIds.papers).toEqual(['*']);
  });

  it('sends separate events for non-overlapping windows', () => {
    pm.enqueueDbChange(['papers'], 'insert');
    vi.advanceTimersByTime(100);

    pm.enqueueDbChange(['concepts'], 'update');
    vi.advanceTimersByTime(100);

    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });
});

describe('PushManager robustness — workflow progress throttle', () => {
  let pm: PushManager;
  let win: ReturnType<typeof makeMockWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    pm = new PushManager();
    win = makeMockWindow();
    pm.setWindow(win as any);
  });

  afterEach(() => {
    pm.destroy();
    vi.useRealTimers();
  });

  it('throttles running events to 500ms intervals', () => {
    const event = (current: number) => ({
      taskId: 't1',
      workflow: 'analyze',
      status: 'running',
      currentStep: 'step',
      progress: { current, total: 10 },
    });

    pm.pushWorkflowProgress(event(1)); // Immediate send
    pm.pushWorkflowProgress(event(2)); // Throttled
    pm.pushWorkflowProgress(event(3)); // Throttled (replaces 2)

    expect(win.webContents.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
    // Should have sent the latest (3), not (2)
    const lastCall = win.webContents.send.mock.calls[1]!;
    expect(lastCall[1].progress.current).toBe(3);
  });

  it('terminal events bypass throttle and cancel pending', () => {
    const running = {
      taskId: 't1',
      workflow: 'analyze',
      status: 'running',
      currentStep: 'step',
      progress: { current: 5, total: 10 },
    };
    const completed = {
      taskId: 't1',
      workflow: 'analyze',
      status: 'completed',
      currentStep: 'done',
      progress: { current: 10, total: 10 },
    };

    pm.pushWorkflowProgress(running); // Immediate
    pm.pushWorkflowProgress(completed); // Immediate (terminal)

    expect(win.webContents.send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(600);
    // No extra send — pending was cancelled
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
  });
});

describe('PushManager robustness — large payload', () => {
  let pm: PushManager;
  let win: ReturnType<typeof makeMockWindow>;

  beforeEach(() => {
    pm = new PushManager();
    win = makeMockWindow();
    pm.setWindow(win as any);
  });

  afterEach(() => {
    pm.destroy();
  });

  it('does not crash on large notification payload', () => {
    const hugeMessage = 'x'.repeat(1_000_000);
    expect(() => {
      pm.pushNotification({ type: 'info', title: 'big', message: hugeMessage });
    }).not.toThrow();
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });
});

describe('PushManager robustness — cleanup', () => {
  it('destroy cancels all pending timers', () => {
    vi.useFakeTimers();
    try {
      const pm = new PushManager();
      const win = makeMockWindow();
      pm.setWindow(win as any);

      pm.enqueueDbChange(['papers'], 'insert');

      pm.destroy();
      vi.advanceTimersByTime(200);

      // Nothing should have been sent after destroy
      expect(win.webContents.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
