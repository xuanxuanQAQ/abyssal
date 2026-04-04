/**
 * TraceStore — 3-tier trace storage.
 *
 * - Memory: latest 50 full traces (ring buffer)
 * - Persistent summary: all completed operations
 * - Persistent full: only failed/aborted/user-marked operations
 */

import type {
  CopilotOperationTrace,
  CopilotOperationTraceSummary,
  TracePhase,
  DegradationRecord,
  CopilotIntent,
  CopilotSurface,
} from './types';

const MAX_MEMORY_TRACES = 50;

export class TraceStore {
  private memoryTraces: CopilotOperationTrace[] = [];
  private summaries: CopilotOperationTraceSummary[] = [];

  createTrace(operationId: string, sessionId: string): CopilotOperationTrace {
    const trace: CopilotOperationTrace = {
      operationId,
      sessionId,
      startedAt: Date.now(),
      phases: [],
    };

    this.memoryTraces.push(trace);
    if (this.memoryTraces.length > MAX_MEMORY_TRACES) {
      this.memoryTraces.shift();
    }

    return trace;
  }

  getTrace(operationId: string): CopilotOperationTrace | undefined {
    return this.memoryTraces.find((t) => t.operationId === operationId);
  }

  startPhase(operationId: string, name: TracePhase['name']): void {
    const trace = this.getTrace(operationId);
    if (!trace) return;

    trace.phases.push({
      name,
      startedAt: Date.now(),
      status: 'running',
    });
  }

  completePhase(
    operationId: string,
    name: TracePhase['name'],
    detail?: Record<string, unknown>,
  ): void {
    const trace = this.getTrace(operationId);
    if (!trace) return;

    const phase = trace.phases.find((p) => p.name === name && p.status === 'running');
    if (phase) {
      phase.status = 'completed';
      phase.finishedAt = Date.now();
      if (detail) phase.detail = detail;
    }
  }

  failPhase(
    operationId: string,
    name: TracePhase['name'],
    error: { code: string; message: string; stack?: string },
  ): void {
    const trace = this.getTrace(operationId);
    if (!trace) return;

    const phase = trace.phases.find((p) => p.name === name && p.status === 'running');
    if (phase) {
      phase.status = 'failed';
      phase.finishedAt = Date.now();
      phase.error = error;
    }
  }

  addDegradation(operationId: string, degradation: DegradationRecord): void {
    const trace = this.getTrace(operationId);
    if (!trace) return;

    if (!trace.degradations) trace.degradations = [];
    trace.degradations.push(degradation);
  }

  finalizeTrace(
    operationId: string,
    status: CopilotOperationTraceSummary['status'],
    intent: CopilotIntent,
    surface: CopilotSurface,
    recipeId?: string,
  ): void {
    const trace = this.getTrace(operationId);
    if (!trace) return;

    trace.finishedAt = Date.now();

    const summary: CopilotOperationTraceSummary = {
      operationId,
      sessionId: trace.sessionId,
      intent,
      surface,
      status,
      ...(recipeId != null ? { recipeId } : {}),
      startedAt: trace.startedAt,
      ...(trace.finishedAt != null ? { finishedAt: trace.finishedAt } : {}),
      ...(trace.finishedAt != null ? { durationMs: trace.finishedAt - trace.startedAt } : {}),
    };

    this.summaries.push(summary);
  }

  getRecentTraces(limit = 10): CopilotOperationTrace[] {
    return this.memoryTraces.slice(-limit);
  }

  getSummaries(limit = 50): CopilotOperationTraceSummary[] {
    return this.summaries.slice(-limit);
  }

  clear(): void {
    this.memoryTraces = [];
    this.summaries = [];
  }
}
