/**
 * PushManager — manages all main→renderer push channels.
 *
 * Responsibilities:
 * - db-changed: 100ms debounce window, merges table names and affected IDs
 * - workflow-progress: throttled to 500ms/push
 * - notification, advisory-suggestions, memo-created, note-indexed: no limit
 *
 * See spec: section 6 — Streaming Push & State Debounce
 */

import type { BrowserWindow } from 'electron';

// ─── Push event types ───

export interface DbChangedEvent {
  tables: string[];
  operations: string[];
  /** Per-table affected IDs. Value of ['*'] means "too many IDs — do full refetch". */
  affectedIds: Record<string, string[]>;
}

export interface WorkflowProgressEvent {
  taskId: string;
  workflow: string;
  status: string;
  currentStep: string;
  progress: { current: number; total: number };
  entityId?: string;
  error?: { code: string; message: string };
  substeps?: Array<{ name: string; status: string; detail?: string }>;
  estimatedRemainingMs?: number | null;
  currentItemLabel?: string;
}

// ─── Push channels ───

export const PUSH_CHANNELS = {
  WORKFLOW_PROGRESS: 'push:workflowProgress',
  STREAM_CHUNK: 'pipeline:streamChunk$event',
  DB_CHANGED: 'push:dbChanged',
  SETTINGS_CHANGED: 'push:settingsChanged',
  NOTIFICATION: 'push:notification',
  ADVISORY_SUGGESTIONS: 'push:advisorySuggestions',
  MEMO_CREATED: 'push:memoCreated',
  NOTE_INDEXED: 'push:noteIndexed',
  DB_HEALTH: 'push:dbHealth',
  EXPORT_PROGRESS: 'push:exportProgress',
  DLA_PAGE_READY: 'push:dlaPageReady',
  AI_COMMAND: 'push:aiCommand',
} as const;

// ─── PushManager ───

interface DbChangePending {
  tables: Set<string>;
  operations: Set<string>;
  affectedIds: Map<string, Set<string>>;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PushManager {
  private _window: BrowserWindow | null = null;
  private _dbChangePending: DbChangePending = {
    tables: new Set(),
    operations: new Set(),
    affectedIds: new Map(),
    timer: null,
  };
  private _lastWorkflowPush = 0;
  private _pendingWorkflowEvent: WorkflowProgressEvent | null = null;
  private _workflowPushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per-task stream chunk buffer for 100ms throttled batching */
  private _streamChunkBuffers = new Map<string, { chunks: string[]; timer: ReturnType<typeof setTimeout> | null }>();

  /** Update the window reference (call after window creation or recreation) */
  setWindow(window: BrowserWindow | null): void {
    this._window = window;
  }

  private send(channel: string, data: unknown): void {
    if (!this._window || this._window.isDestroyed()) {
      // Window unavailable — silently drop
      return;
    }
    this._window.webContents.send(channel, data);
  }

  // ── db-changed (100ms debounce) ──

  /**
   * Enqueue a db-changed notification.
   *
   * Multiple calls within the 100ms window are merged:
   * - Table names are unioned
   * - Operations are unioned
   * - Affected IDs per table are merged (capped at 50; beyond → full refetch)
   */
  enqueueDbChange(
    tables: string[],
    operation: 'insert' | 'update' | 'delete',
    affectedIds?: Record<string, string[]>,
  ): void {
    const p = this._dbChangePending;

    for (const t of tables) p.tables.add(t);
    p.operations.add(operation);

    if (affectedIds) {
      for (const [table, ids] of Object.entries(affectedIds)) {
        const existing = p.affectedIds.get(table) ?? new Set<string>();
        for (const id of ids) existing.add(id);
        if (existing.size > 50) {
          // Too many IDs — signal renderer to do full refetch with ['*'] sentinel
          p.affectedIds.set(table, new Set(['*']));
        } else {
          p.affectedIds.set(table, existing);
        }
      }
    }

    // Reset debounce timer
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => this.flushDbChange(), 100);
  }

  private flushDbChange(): void {
    const p = this._dbChangePending;
    if (p.tables.size === 0) return;

    const event: DbChangedEvent = {
      tables: Array.from(p.tables),
      operations: Array.from(p.operations),
      affectedIds: Object.fromEntries(
        Array.from(p.affectedIds.entries()).map(([table, ids]) => [
          table,
          Array.from(ids),
        ]),
      ),
    };

    this.send(PUSH_CHANNELS.DB_CHANGED, event);

    // Reset pending state
    p.tables.clear();
    p.operations.clear();
    p.affectedIds.clear();
    p.timer = null;
  }

  // ── workflow-progress (500ms throttle) ──

  pushWorkflowProgress(event: WorkflowProgressEvent): void {
    // Terminal events (completed/failed/cancelled) always bypass throttle
    // and cancel any pending trailing event to prevent stale running events
    // from arriving after the terminal event on the renderer side.
    if (event.status !== 'running') {
      if (this._workflowPushTimer) {
        clearTimeout(this._workflowPushTimer);
        this._workflowPushTimer = null;
        this._pendingWorkflowEvent = null;
      }
      this.send(PUSH_CHANNELS.WORKFLOW_PROGRESS, event);
      return;
    }

    const now = Date.now();
    if (now - this._lastWorkflowPush >= 500) {
      // Outside throttle window — send immediately
      this._lastWorkflowPush = now;
      this.send(PUSH_CHANNELS.WORKFLOW_PROGRESS, event);
    } else {
      // Inside throttle window — store as pending and schedule trailing send.
      // This ensures the latest progress (e.g. item completion) is never lost.
      this._pendingWorkflowEvent = event;
      if (!this._workflowPushTimer) {
        this._workflowPushTimer = setTimeout(() => {
          this._workflowPushTimer = null;
          if (this._pendingWorkflowEvent) {
            this._lastWorkflowPush = Date.now();
            this.send(PUSH_CHANNELS.WORKFLOW_PROGRESS, this._pendingWorkflowEvent);
            this._pendingWorkflowEvent = null;
          }
        }, 500 - (now - this._lastWorkflowPush));
      }
    }
  }

  // ── notification (no limit) ──

  pushNotification(notification: { type: string; title: string; message: string; [key: string]: unknown }): void {
    this.send(PUSH_CHANNELS.NOTIFICATION, notification);
  }

  // ── advisory-suggestions (no limit) ──

  pushAdvisorySuggestions(suggestions: unknown[]): void {
    this.send(PUSH_CHANNELS.ADVISORY_SUGGESTIONS, suggestions);
  }

  // ── memo-created (no limit) ──

  pushMemoCreated(data: { memoId: string }): void {
    this.send(PUSH_CHANNELS.MEMO_CREATED, data);
  }

  // ── note-indexed (no limit) ──

  pushNoteIndexed(data: { noteId: string; chunkCount: number }): void {
    this.send(PUSH_CHANNELS.NOTE_INDEXED, data);
  }

  // ── db-health (no limit) ──

  pushDbHealth(data: { status: 'connected' | 'degraded' | 'disconnected' }): void {
    this.send(PUSH_CHANNELS.DB_HEALTH, data);
  }

  // ── settings-changed (no limit) ──

  pushSettingsChanged(data: { section: string; keys: string[] }): void {
    this.send(PUSH_CHANNELS.SETTINGS_CHANGED, data);
  }

  // ── export-progress (no limit) ──

  pushExportProgress(data: { stage: string; progress: number; message: string }): void {
    this.send(PUSH_CHANNELS.EXPORT_PROGRESS, data);
  }

  // ── dla-page-ready (no limit) ──

  pushDlaPageReady(data: { paperId: string; pageIndex: number; blocks: unknown[] }): void {
    this.send(PUSH_CHANNELS.DLA_PAGE_READY, data);
  }

  // ── ai-command (no limit) — AI-initiated UI actions ──

  pushAiCommand(data: unknown): void {
    this.send(PUSH_CHANNELS.AI_COMMAND, data);
  }

  // ── advisory-navigate (no limit) ──

  pushAdvisoryNavigate(data: { route: string }): void {
    this.send('advisory:navigate$event', data);
  }

  // ── workspace-switched (no limit) ──

  pushWorkspaceSwitched(data: { rootDir: string; name: string }): void {
    this.send('workspace:switched$event', data);
  }

  // ── copilot events (no limit) — unified runtime events ──

  pushCopilotEvent(data: unknown): void {
    this.send('push:copilotEvent', data);
  }

  pushCopilotSessionChanged(data: { sessionId: string; operationId: string }): void {
    this.send('push:copilotSessionChanged', data);
  }

  // ── stream-chunk (100ms throttle, batched per task) ──

  /**
   * Push a workflow stream chunk to the renderer.
   * Chunks are batched per-task and flushed every 100ms to avoid flooding IPC.
   * When isLast=true, the buffer is flushed immediately.
   */
  pushStreamChunk(taskId: string, chunk: string, isLast: boolean): void {
    let buf = this._streamChunkBuffers.get(taskId);
    if (!buf) {
      buf = { chunks: [], timer: null };
      this._streamChunkBuffers.set(taskId, buf);
    }
    buf.chunks.push(chunk);

    if (isLast) {
      // Flush immediately on last chunk
      if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
      this.send(PUSH_CHANNELS.STREAM_CHUNK, { taskId, chunk: buf.chunks.join(''), isLast: true });
      this._streamChunkBuffers.delete(taskId);
      return;
    }

    if (!buf.timer) {
      buf.timer = setTimeout(() => {
        const b = this._streamChunkBuffers.get(taskId);
        if (b && b.chunks.length > 0) {
          this.send(PUSH_CHANNELS.STREAM_CHUNK, { taskId, chunk: b.chunks.join(''), isLast: false });
          b.chunks = [];
        }
        if (b) b.timer = null;
      }, 100);
    }
  }

  // ── cleanup ──

  destroy(): void {
    if (this._dbChangePending.timer) {
      clearTimeout(this._dbChangePending.timer);
      this._dbChangePending.timer = null;
    }
    if (this._workflowPushTimer) {
      clearTimeout(this._workflowPushTimer);
      this._workflowPushTimer = null;
      this._pendingWorkflowEvent = null;
    }
    for (const buf of this._streamChunkBuffers.values()) {
      if (buf.timer) clearTimeout(buf.timer);
    }
    this._streamChunkBuffers.clear();
    this._window = null;
  }
}
