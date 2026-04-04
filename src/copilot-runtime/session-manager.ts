/**
 * CopilotSessionManager — manages Copilot sessions (not chat sessions).
 *
 * A CopilotSession groups related operations with shared context.
 * Sessions are tied to workspace and can span multiple surfaces.
 */

import type {
  CopilotSessionState,
  CopilotSessionSummary,
  CopilotOperationEvent,
  ContextSnapshot,
  ClarificationRequest,
  CopilotOperation,
  OperationStatusSnapshot,
  OperationTerminalState,
} from './types';
import type { ViewType } from '../shared-types/enums';

const MAX_TIMELINE_EVENTS = 200;
const MAX_SESSIONS = 50;

export class CopilotSessionManager {
  private sessions = new Map<string, CopilotSessionState>();
  private operationToSession = new Map<string, string>();
  private terminalStates = new Map<string, OperationTerminalState>();

  getOrCreate(sessionId: string, title?: string): CopilotSessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        title: title ?? `Session ${sessionId.substring(0, 8)}`,
        timeline: [],
      };
      this.sessions.set(sessionId, session);
      this.evictOldSessions();
    }
    return session;
  }

  get(sessionId: string): CopilotSessionState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(): CopilotSessionSummary[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      title: s.title,
      activeView: 'library' as ViewType,
      updatedAt: s.timeline.length > 0
        ? s.timeline[s.timeline.length - 1]!.emittedAt
        : Date.now(),
    }));
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    // Clean up operation mappings
    for (const [opId, sId] of this.operationToSession) {
      if (sId === sessionId) {
        this.operationToSession.delete(opId);
        this.terminalStates.delete(opId);
      }
    }
  }

  /** Track an operation within a session */
  trackOperation(operation: CopilotOperation): void {
    const session = this.getOrCreate(operation.sessionId);
    session.activeOperationId = operation.id;
    session.lastContextSnapshot = operation.context;
    this.operationToSession.set(operation.id, operation.sessionId);
  }

  /** Look up the session ID that owns a given operation */
  getSessionIdForOperation(operationId: string): string | null {
    return this.operationToSession.get(operationId) ?? null;
  }

  /** Append an event to the session timeline */
  appendEvent(event: CopilotOperationEvent): void {
    const sessionId = this.operationToSession.get(event.operationId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.timeline.push(event);
    if (session.timeline.length > MAX_TIMELINE_EVENTS) {
      session.timeline = session.timeline.slice(-MAX_TIMELINE_EVENTS);
    }

    if (
      event.type === 'operation.clarification_required' ||
      (event.type === 'operation.completed' && event.resultSummary === 'clarification_required')
    ) {
      if (session.activeOperationId === event.operationId) {
        delete session.activeOperationId;
      }
      return;
    }

    // Track terminal states
    if (
      event.type === 'operation.completed' ||
      event.type === 'operation.failed' ||
      event.type === 'operation.aborted'
    ) {
      const terminalStatus = event.type === 'operation.completed'
        ? 'completed' as const
        : event.type === 'operation.failed'
          ? 'failed' as const
          : 'aborted' as const;

      this.terminalStates.set(event.operationId, {
        operationId: event.operationId,
        terminalStatus,
        terminalAt: event.emittedAt,
      });

      if (session.activeOperationId === event.operationId) {
        delete session.activeOperationId;
      }
    }
  }

  /** Set pending clarification for a session */
  setPendingClarification(sessionId: string, clarification: ClarificationRequest): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pendingClarification = clarification;
      session.lastContextSnapshot = clarification.resumeOperation.context;
      if (session.activeOperationId === clarification.operationId) {
        delete session.activeOperationId;
      }
      this.terminalStates.delete(clarification.operationId);
    }
  }

  /** Clear pending clarification */
  clearPendingClarification(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      delete session.pendingClarification;
    }
  }

  /** Check if an operation has reached a terminal state */
  isTerminal(operationId: string): boolean {
    return this.terminalStates.has(operationId);
  }

  /** Get terminal state for an operation */
  getTerminalState(operationId: string): OperationTerminalState | undefined {
    return this.terminalStates.get(operationId);
  }

  /** Get operation status snapshot for polling fallback */
  getOperationStatus(operationId: string): OperationStatusSnapshot | null {
    const sessionId = this.operationToSession.get(operationId);
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const terminal = this.terminalStates.get(operationId);
    const isActive = session.activeOperationId === operationId;
    const hasPendingClarification =
      session.pendingClarification?.operationId === operationId;

    // Find last event for this operation
    const events = session.timeline.filter((e) => e.operationId === operationId);
    const lastEvent = events[events.length - 1];

    let status: OperationStatusSnapshot['status'] = 'running';
    if (hasPendingClarification) {
      status = 'clarification_required';
    } else if (terminal) {
      status = terminal.terminalStatus;
    } else if (!isActive) {
      status = 'completed'; // not active and not terminal — assume done
    }

    return {
      operationId,
      sessionId,
      status,
      lastSequence: lastEvent?.sequence ?? 0,
      updatedAt: lastEvent?.emittedAt ?? Date.now(),
    };
  }

  private evictOldSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;

    // Evict oldest sessions based on last activity
    const entries = Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      lastActivity: s.timeline.length > 0
        ? s.timeline[s.timeline.length - 1]!.emittedAt
        : 0,
    }));

    entries.sort((a, b) => a.lastActivity - b.lastActivity);
    const toRemove = entries.slice(0, entries.length - MAX_SESSIONS);
    for (const entry of toRemove) {
      this.clear(entry.id);
    }
  }
}
