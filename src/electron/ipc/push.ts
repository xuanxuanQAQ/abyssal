/**
 * PushManager — manages all main→renderer push channels.
 *
 * Responsibilities:
 * - db-changed: 100ms debounce window, merges table names and affected IDs
 * - workflow-progress: throttled to 500ms/push
 * - agent-stream: no limit (per-token push)
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
  workflowId: string;
  type: string;
  status: string;
  currentStep: string;
  progress: { current: number; total: number };
  error?: { code: string; message: string };
}

export interface AgentStreamChunk {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_result' | 'done' | 'error';
  conversationId: string;
  [key: string]: unknown;
}

// ─── Push channels ───

export const PUSH_CHANNELS = {
  WORKFLOW_PROGRESS: 'push:workflow-progress',
  AGENT_STREAM: 'push:agent-stream',
  DB_CHANGED: 'push:db-changed',
  NOTIFICATION: 'push:notification',
  ADVISORY_SUGGESTIONS: 'push:advisory-suggestions',
  MEMO_CREATED: 'push:memo-created',
  NOTE_INDEXED: 'push:note-indexed',
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

  /** Update the window reference (call after window creation or recreation) */
  setWindow(window: BrowserWindow | null): void {
    this._window = window;
  }

  private send(channel: string, data: unknown): void {
    if (!this._window || this._window.isDestroyed()) return;
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
    const now = Date.now();
    if (now - this._lastWorkflowPush < 500) return;
    this._lastWorkflowPush = now;
    this.send(PUSH_CHANNELS.WORKFLOW_PROGRESS, event);
  }

  // ── agent-stream (no limit) ──

  pushAgentStream(chunk: AgentStreamChunk): void {
    this.send(PUSH_CHANNELS.AGENT_STREAM, chunk);
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

  // ── cleanup ──

  destroy(): void {
    if (this._dbChangePending.timer) {
      clearTimeout(this._dbChangePending.timer);
      this._dbChangePending.timer = null;
    }
    this._window = null;
  }
}
