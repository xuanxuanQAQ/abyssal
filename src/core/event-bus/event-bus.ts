/**
 * EventBus — unified publish/subscribe backbone for AI-centric workbench.
 *
 * All user actions, pipeline events, data changes, and AI commands
 * flow through this single bus. The SessionOrchestrator subscribes
 * to observe and proactively react.
 *
 * Features:
 * - Type-safe subscribe/emit by event type
 * - Wildcard subscription (subscribe to all events)
 * - Event history ring buffer (last N events for context replay)
 * - Async listener support
 * - Middleware pipeline (for logging, throttling, etc.)
 */

import type { AppEvent, AppEventType, AppEventOf } from './event-types';

// ─── Types ───

type Listener<T extends AppEvent = AppEvent> = (event: T) => void | Promise<void>;
type Middleware = (event: AppEvent, next: () => void) => void | Promise<void>;

export interface EventBusOptions {
  /** Max events to keep in history ring buffer (default: 200) */
  historySize?: number;
  /** Enable debug logging of all events (default: false) */
  debug?: boolean;
  /** Logger function (defaults to console.log) */
  logger?: (msg: string, data?: unknown) => void;
}

interface SubscriptionHandle {
  unsubscribe: () => void;
}

// ─── EventBus ───

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly wildcardListeners = new Set<Listener>();
  private readonly middlewares: Middleware[] = [];
  private readonly history: AppEvent[] = [];
  private readonly historySize: number;
  private readonly debug: boolean;
  private readonly logger: (msg: string, data?: unknown) => void;
  private _paused = false;
  private _queueWhilePaused: AppEvent[] = [];

  constructor(opts: EventBusOptions = {}) {
    this.historySize = opts.historySize ?? 200;
    this.debug = opts.debug ?? false;
    this.logger = opts.logger ?? (() => {});
  }

  // ─── Subscribe ───

  /**
   * Subscribe to a specific event type.
   *
   * @example
   * bus.on('user:navigate', (e) => { console.log(e.view); });
   */
  on<T extends AppEventType>(type: T, listener: Listener<AppEventOf<T>>): SubscriptionHandle {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener as Listener);
    return { unsubscribe: () => listeners!.delete(listener as Listener) };
  }

  /**
   * Subscribe to all events (wildcard).
   * Useful for logging, session context tracking, and the orchestrator.
   */
  onAny(listener: Listener): SubscriptionHandle {
    this.wildcardListeners.add(listener);
    return { unsubscribe: () => this.wildcardListeners.delete(listener) };
  }

  /**
   * Subscribe once — listener auto-unsubscribes after first invocation.
   */
  once<T extends AppEventType>(type: T, listener: Listener<AppEventOf<T>>): SubscriptionHandle {
    const handle = this.on(type, (event) => {
      handle.unsubscribe();
      listener(event);
    });
    return handle;
  }

  /**
   * Wait for a specific event type (Promise-based).
   *
   * @example
   * const result = await bus.waitFor('pipeline:complete', 30000);
   */
  waitFor<T extends AppEventType>(
    type: T,
    timeoutMs = 0,
    predicate?: (event: AppEventOf<T>) => boolean,
  ): Promise<AppEventOf<T>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const handle = this.on(type, (event) => {
        if (predicate && !predicate(event)) return;
        handle.unsubscribe();
        if (timer) clearTimeout(timer);
        resolve(event);
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          handle.unsubscribe();
          reject(new Error(`EventBus.waitFor('${type}') timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
    });
  }

  // ─── Emit ───

  /**
   * Emit an event. Runs through middleware pipeline, then dispatches
   * to type-specific listeners and wildcard listeners.
   */
  private static readonly MAX_PAUSE_QUEUE = 500;

  async emit(event: AppEvent): Promise<void> {
    if (this._paused) {
      // Bounded pause queue — drop oldest if overflowing
      if (this._queueWhilePaused.length >= EventBus.MAX_PAUSE_QUEUE) {
        this._queueWhilePaused.shift();
      }
      this._queueWhilePaused.push(event);
      return;
    }

    // Record in history
    this.history.push(event);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    if (this.debug) {
      this.logger(`[EventBus] ${event.type}`, event);
    }

    // Run middleware pipeline
    let proceed = true;
    for (const mw of this.middlewares) {
      let called = false;
      await mw(event, () => { called = true; });
      if (!called) {
        proceed = false;
        break;
      }
    }
    if (!proceed) return;

    // Dispatch to type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          await listener(event);
        } catch (err) {
          this.logger(`[EventBus] Listener error on '${event.type}'`, err);
        }
      }
    }

    // Dispatch to wildcard listeners
    for (const listener of this.wildcardListeners) {
      try {
        await listener(event);
      } catch (err) {
        this.logger(`[EventBus] Wildcard listener error on '${event.type}'`, err);
      }
    }
  }

  // ─── Middleware ───

  /**
   * Add middleware to the event pipeline.
   * Middleware must call `next()` to allow the event to proceed.
   * If `next()` is not called, the event is swallowed.
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  // ─── History ───

  /**
   * Get recent event history, optionally filtered by type.
   */
  getHistory(filter?: { type?: AppEventType; limit?: number }): AppEvent[] {
    let events = this.history;
    if (filter?.type) {
      events = events.filter((e) => e.type === filter.type);
    }
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    return [...events];
  }

  /**
   * Get the most recent event of a given type.
   */
  getLatest<T extends AppEventType>(type: T): AppEventOf<T> | null {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.type === type) return this.history[i] as AppEventOf<T>;
    }
    return null;
  }

  // ─── Pause / Resume ───

  /**
   * Pause event dispatching. Events emitted while paused are queued
   * and flushed on resume. Useful during batch operations.
   */
  pause(): void {
    this._paused = true;
  }

  /**
   * Resume event dispatching and flush queued events.
   */
  async resume(): Promise<void> {
    this._paused = false;
    const queued = this._queueWhilePaused;
    this._queueWhilePaused = [];
    for (const event of queued) {
      await this.emit(event);
    }
  }

  // ─── Throttle Middleware ───

  /**
   * Install a throttle middleware for high-frequency event types.
   * Events of the specified types are debounced: only the latest event
   * within `intervalMs` is dispatched, earlier ones are dropped.
   *
   * @param eventTypes - Event types to throttle (e.g., ['user:pageChange', 'user:selectText'])
   * @param intervalMs - Minimum interval between dispatches (default: 150ms)
   */
  useThrottle(eventTypes: string[], intervalMs = 150): void {
    const lastEmitted = new Map<string, number>();
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    this.use((event, next) => {
      if (!eventTypes.includes(event.type)) {
        next();
        return;
      }

      const now = Date.now();
      const last = lastEmitted.get(event.type) ?? 0;

      // Clear any pending delayed emit for this type
      const existingTimer = pending.get(event.type);
      if (existingTimer) clearTimeout(existingTimer);

      if (now - last >= intervalMs) {
        // Enough time passed — emit immediately
        lastEmitted.set(event.type, now);
        next();
      } else {
        // Too soon — schedule a trailing emit with the latest event
        const delay = intervalMs - (now - last);
        pending.set(event.type, setTimeout(() => {
          pending.delete(event.type);
          lastEmitted.set(event.type, Date.now());
          // Re-emit bypasses middleware (already throttled)
          this.dispatchToListeners(event);
        }, delay));
        // Don't call next() — swallow this event for now
      }
    });
  }

  // ─── Cleanup ───

  /**
   * Remove all listeners for a specific event type.
   */
  removeAllListeners(type?: AppEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
      this.wildcardListeners.clear();
    }
  }

  /**
   * Clear event history.
   */
  clearHistory(): void {
    this.history.length = 0;
  }

  /**
   * Full cleanup.
   */
  destroy(): void {
    this.removeAllListeners();
    this.middlewares.length = 0;
    this.clearHistory();
    this._queueWhilePaused.length = 0;
  }

  /**
   * Dispatch to listeners directly (bypassing middleware).
   * Used internally by throttle trailing emit.
   */
  private async dispatchToListeners(event: AppEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.historySize) this.history.shift();

    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try { await listener(event); } catch (err) {
          this.logger(`[EventBus] Listener error on '${event.type}'`, err);
        }
      }
    }
    for (const listener of this.wildcardListeners) {
      try { await listener(event); } catch (err) {
        this.logger(`[EventBus] Wildcard listener error on '${event.type}'`, err);
      }
    }
  }

  /** Number of registered listener entries (for diagnostics). */
  get listenerCount(): number {
    let count = this.wildcardListeners.size;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}
