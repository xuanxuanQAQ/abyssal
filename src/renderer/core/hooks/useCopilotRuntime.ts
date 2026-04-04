/**
 * useCopilotRuntime — unified frontend hook for Copilot Runtime operations.
 *
 * Replaces direct usage of:
 *   - getAPI().chat.send() (→ copilot:execute)
 *   - getAPI().pipeline.start() (→ copilot:execute)
 *   - push:agentStream (→ push:copilotEvent)
 *
 * Provides: execute, abort, resume, event subscription, and operation state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAPI } from '../ipc/bridge';
import type {
  CopilotOperationEnvelope,
  CopilotExecuteResult,
  CopilotOperationEvent,
  CopilotSessionSummary,
  CopilotSessionState,
  OperationStatusSnapshot,
  ResumeOperationRequest,
} from '../../../copilot-runtime/types';

// ─── Operation tracker ───

export interface CopilotOperationState {
  operationId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'clarification_required';
  events: CopilotOperationEvent[];
  /** Accumulated chat text from model.delta events */
  chatText: string;
  /** Accumulated draft text from model.delta events */
  draftText: string;
}

// ─── Hook return type ───

export interface CopilotRuntimeHook {
  /** Execute a copilot operation */
  execute: (envelope: CopilotOperationEnvelope) => Promise<CopilotExecuteResult>;
  /** Abort an in-flight operation */
  abort: (operationId: string) => Promise<void>;
  /** Resume a clarification-paused operation */
  resume: (request: ResumeOperationRequest) => Promise<CopilotExecuteResult>;
  /** Get operation status by polling */
  getOperationStatus: (operationId: string) => Promise<OperationStatusSnapshot | null>;
  /** List all sessions */
  listSessions: () => Promise<CopilotSessionSummary[]>;
  /** Get a specific session */
  getSession: (sessionId: string) => Promise<CopilotSessionState | null>;
  /** Clear a session */
  clearSession: (sessionId: string) => Promise<void>;
  /** Currently tracked operations (keyed by operationId) */
  operations: Map<string, CopilotOperationState>;
  /** The most recently started operation */
  activeOperation: CopilotOperationState | null;
}

export function useCopilotRuntime(): CopilotRuntimeHook {
  const [operations, setOperations] = useState<Map<string, CopilotOperationState>>(
    () => new Map(),
  );
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const pendingEventsRef = useRef<Map<string, CopilotOperationEvent[]>>(new Map());

  const applyEvent = useCallback((state: CopilotOperationState, evt: CopilotOperationEvent): CopilotOperationState => {
    const isTerminal = state.status === 'completed' || state.status === 'failed' || state.status === 'aborted';
    if (isTerminal && evt.type === 'model.delta') {
      return state;
    }

    const updated: CopilotOperationState = {
      ...state,
      events: [...state.events, evt],
    };

    if (evt.type === 'model.delta') {
      if (evt.channel === 'chat') {
        updated.chatText += evt.text;
      } else {
        updated.draftText += evt.text;
      }
    }

    if (evt.type === 'operation.clarification_required') {
      updated.status = 'clarification_required';
    } else if (evt.type === 'operation.completed') {
      updated.status = evt.resultSummary === 'clarification_required'
        ? 'clarification_required'
        : 'completed';
    } else if (evt.type === 'operation.failed') {
      updated.status = 'failed';
    } else if (evt.type === 'operation.aborted') {
      updated.status = 'aborted';
    }

    return updated;
  }, []);

  // ── Event subscription ──

  useEffect(() => {
    const api = getAPI();
    const unsub = api.on.copilotEvent((event: unknown) => {
      const evt = event as CopilotOperationEvent;
      setOperations((prev) => {
        const next = new Map(prev);
        const existing = next.get(evt.operationId);
        if (!existing) {
          const buffered = pendingEventsRef.current.get(evt.operationId) ?? [];
          pendingEventsRef.current.set(evt.operationId, [...buffered, evt]);
          return prev;
        }

        next.set(evt.operationId, applyEvent(existing, evt));
        return next;
      });
    });

    return () => unsub();
  }, [applyEvent]);

  // ── IPC wrappers ──

  const execute = useCallback(async (envelope: CopilotOperationEnvelope): Promise<CopilotExecuteResult> => {
    const api = getAPI();
    const initialOperationId = envelope.operation.id;
    const initialSessionId = envelope.operation.sessionId;

    if (initialOperationId) {
      setOperations((prev) => {
        if (prev.has(initialOperationId)) return prev;
        const next = new Map(prev);
        next.set(initialOperationId, {
          operationId: initialOperationId,
          sessionId: initialSessionId,
          status: 'running',
          events: [],
          chatText: '',
          draftText: '',
        });
        return next;
      });
      setActiveOperationId(initialOperationId);
    }

    const result = await api.copilot.execute(envelope) as CopilotExecuteResult;

    setOperations((prev) => {
      const next = new Map(prev);
      const existing = next.get(result.operationId)
        ?? (initialOperationId ? next.get(initialOperationId) : undefined);

      let state: CopilotOperationState = existing ?? {
        operationId: result.operationId,
        sessionId: result.sessionId,
        status: 'running',
        events: [],
        chatText: '',
        draftText: '',
      };

      state = {
        ...state,
        operationId: result.operationId,
        sessionId: result.sessionId,
      };

      const bufferedForResult = pendingEventsRef.current.get(result.operationId) ?? [];
      for (const evt of bufferedForResult) {
        state = applyEvent(state, evt);
      }
      pendingEventsRef.current.delete(result.operationId);

      if (initialOperationId && initialOperationId !== result.operationId) {
        const bufferedForInitial = pendingEventsRef.current.get(initialOperationId) ?? [];
        for (const evt of bufferedForInitial) {
          state = applyEvent(state, evt);
        }
        pendingEventsRef.current.delete(initialOperationId);
        next.delete(initialOperationId);
      }

      next.set(result.operationId, state);
      return next;
    });
    setActiveOperationId(result.operationId);

    return result;
  }, [applyEvent]);

  const abort = useCallback(async (operationId: string): Promise<void> => {
    const api = getAPI();
    await api.copilot.abort(operationId);
  }, []);

  const resume = useCallback(async (request: ResumeOperationRequest): Promise<CopilotExecuteResult> => {
    const api = getAPI();
    const result = await api.copilot.resume(request) as CopilotExecuteResult;

    setOperations((prev) => {
      const next = new Map(prev);
      const existing = next.get(result.operationId);
      next.set(result.operationId, existing ?? {
        operationId: result.operationId,
        sessionId: result.sessionId,
        status: 'running',
        events: [],
        chatText: '',
        draftText: '',
      });
      return next;
    });
    setActiveOperationId(result.operationId);

    return result;
  }, []);

  const getOperationStatus = useCallback(async (operationId: string): Promise<OperationStatusSnapshot | null> => {
    const api = getAPI();
    return await api.copilot.getOperationStatus(operationId) as OperationStatusSnapshot | null;
  }, []);

  const listSessions = useCallback(async (): Promise<CopilotSessionSummary[]> => {
    const api = getAPI();
    return await api.copilot.listSessions() as CopilotSessionSummary[];
  }, []);

  const getSession = useCallback(async (sessionId: string): Promise<CopilotSessionState | null> => {
    const api = getAPI();
    return await api.copilot.getSession(sessionId) as CopilotSessionState | null;
  }, []);

  const clearSession = useCallback(async (sessionId: string): Promise<void> => {
    const api = getAPI();
    await api.copilot.clearSession(sessionId);
  }, []);

  const activeOperation = activeOperationId
    ? operations.get(activeOperationId) ?? null
    : null;

  return {
    execute,
    abort,
    resume,
    getOperationStatus,
    listSessions,
    getSession,
    clearSession,
    operations,
    activeOperation,
  };
}
