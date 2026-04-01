/**
 * useEventBridge — renderer-side React hooks for the AI-centric EventBus.
 *
 * Two responsibilities:
 * 1. Emit user behavior events → main process → EventBus
 * 2. Listen for AI command events ← main process ← EventBus
 *
 * Components call `emitUserAction(...)` to report user behavior.
 * Components use `useAICommand(...)` to react to AI-initiated UI actions.
 */

import { useEffect, useCallback, useRef } from 'react';
import type { UserActionPayload, AICommandPayload } from '../../../shared-types/ipc/contract';

// ─── Emit user actions to main process ───

/**
 * Send a user action event to the main process EventBus.
 * Fire-and-forget — no response expected.
 */
export function emitUserAction(payload: UserActionPayload): void {
  (window as any).abyssal?.event?.userAction?.(payload);
}

/**
 * Respond to an AI suggestion (when user clicks an action button).
 */
export function emitSuggestionResponse(suggestionId: string, actionId: string): void {
  (window as any).abyssal?.event?.suggestionResponse?.(suggestionId, actionId);
}

// ─── Listen for AI commands from main process ───

type AICommandHandler<C extends AICommandPayload['command']> = (
  payload: Extract<AICommandPayload, { command: C }>
) => void;

/**
 * Subscribe to AI command events from the main process.
 *
 * @example
 * useAICommand('navigate', (payload) => {
 *   store.switchView(payload.view);
 *   if (payload.target?.paperId) store.selectPaper(payload.target.paperId);
 * });
 */
export function useAICommand<C extends AICommandPayload['command']>(
  command: C,
  handler: AICommandHandler<C>,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = (window as any).abyssal?.on?.aiCommand?.((payload: AICommandPayload) => {
      if (payload.command === command) {
        handlerRef.current(payload as Extract<AICommandPayload, { command: C }>);
      }
    });
    return () => unsub?.();
  }, [command]);
}

/**
 * Subscribe to ALL AI command events.
 *
 * @example
 * useAICommands((payload) => {
 *   switch (payload.command) {
 *     case 'navigate': ...
 *     case 'notify': ...
 *   }
 * });
 */
export function useAICommands(handler: (payload: AICommandPayload) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = (window as any).abyssal?.on?.aiCommand?.((payload: AICommandPayload) => {
      handlerRef.current(payload);
    });
    return () => unsub?.();
  }, []);
}

// ─── Convenience hooks for common user actions ───

/**
 * Hook that returns a callback to emit navigation events.
 * Call this when the user navigates to a different view.
 */
export function useEmitNavigation() {
  return useCallback((
    view: string,
    previousView: string,
    target?: { paperId?: string; conceptId?: string; articleId?: string; noteId?: string },
  ) => {
    emitUserAction({
      action: 'navigate',
      view: view as any,
      previousView: previousView as any,
      ...(target !== undefined && { target }),
    });
  }, []);
}

/**
 * Hook that returns a callback to emit paper selection events.
 */
export function useEmitSelectPaper() {
  return useCallback((paperId: string, source: string) => {
    emitUserAction({ action: 'selectPaper', paperId, source });
  }, []);
}

/**
 * Hook that returns a callback to emit text selection events.
 */
export function useEmitSelectText() {
  return useCallback((paperId: string, text: string, page: number) => {
    emitUserAction({ action: 'selectText', paperId, text, page });
  }, []);
}

/**
 * Hook that returns a callback to emit paper open events.
 */
export function useEmitOpenPaper() {
  return useCallback((paperId: string, hasPdf: boolean) => {
    emitUserAction({ action: 'openPaper', paperId, hasPdf });
  }, []);
}

/**
 * Hook that returns a callback to emit search events.
 */
export function useEmitSearch() {
  return useCallback((query: string, scope: string) => {
    emitUserAction({ action: 'search', query, scope });
  }, []);
}
