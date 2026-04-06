/**
 * OperationEventEmitter — side-channel notification system.
 *
 * NOT a control bus. Events are emitted after each phase completes,
 * used for UI sync, Timeline recording, and tracing.
 * Does NOT drive the next execution phase.
 */

import type { CopilotOperationEvent } from './types';

/**
 * Event payload without auto-populated fields.
 * Uses a distributive conditional type to preserve the discriminated union.
 */
export type CopilotEventPayload =
  CopilotOperationEvent extends infer E
    ? E extends CopilotOperationEvent
      ? Omit<E, 'sequence' | 'emittedAt'>
      : never
    : never;

export type CopilotEventListener = (event: CopilotOperationEvent) => void;

export class OperationEventEmitter {
  private listeners = new Set<CopilotEventListener>();
  private sequenceCounters = new Map<string, number>();

  on(listener: CopilotEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: CopilotEventPayload): CopilotOperationEvent {
    const operationId = event.operationId;
    const seq = (this.sequenceCounters.get(operationId) ?? 0) + 1;
    this.sequenceCounters.set(operationId, seq);

    const fullEvent = {
      ...event,
      sequence: seq,
      emittedAt: Date.now(),
    } as CopilotOperationEvent;

    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        // listener errors must not break the main chain
        console.warn('[OperationEventEmitter] listener threw:', err);
      }
    }

    return fullEvent;
  }

  /** Clean up sequence counter for a finished operation */
  releaseOperation(operationId: string): void {
    this.sequenceCounters.delete(operationId);
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.sequenceCounters.clear();
  }
}
