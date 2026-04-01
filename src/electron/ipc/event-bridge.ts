/**
 * EventBridge — bidirectional bridge between EventBus and IPC.
 *
 * Main → Renderer: AI command events on EventBus are forwarded to push:aiCommand
 * Renderer → Main: User action events from IPC are forwarded to EventBus
 *
 * This is the glue layer that connects the AI-centric EventBus architecture
 * to the Electron IPC transport.
 */

import { ipcMain } from 'electron';
import type { EventBus } from '../../core/event-bus';
import type { PushManager } from './push';
import type { UserActionPayload, AICommandPayload } from '../../shared-types/ipc/contract';

/**
 * Wire up the EventBus ↔ IPC bridge.
 *
 * Call this once after EventBus, PushManager, and the main window are ready.
 */
export function setupEventBridge(
  eventBus: EventBus,
  pushManager: PushManager,
  logger?: (msg: string, data?: Record<string, unknown>) => void,
): () => void {
  const log = logger ?? (() => {});
  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  // ═══ Main → Renderer: forward AI command events to push:aiCommand ═══

  const aiEventMap: Record<string, (event: any) => AICommandPayload | null> = {
    'ai:navigate': (e) => ({
      command: 'navigate',
      view: e.view,
      target: e.target,
      reason: e.reason,
    }),
    'ai:highlightPassage': (e) => ({
      command: 'highlightPassage',
      paperId: e.paperId,
      page: e.page,
      text: e.text,
      persistent: e.persistent,
      rect: e.rect,
    }),
    'ai:suggest': (e) => ({
      command: 'suggest',
      suggestion: e.suggestion,
    }),
    'ai:focusEntity': (e) => ({
      command: 'focusEntity',
      entityType: e.entityType,
      entityId: e.entityId,
      anchor: e.anchor,
    }),
    'ai:showComparison': (e) => ({
      command: 'showComparison',
      items: e.items,
      aspect: e.aspect,
    }),
    'ai:notify': (e) => ({
      command: 'notify',
      level: e.level,
      title: e.title,
      message: e.message,
    }),
    'ai:updateSettings': (e) => ({
      command: 'updateSettings',
      section: e.section,
      patch: e.patch,
      reason: e.reason,
    }),
  };

  // Subscribe to all AI event types and forward to renderer
  for (const [eventType, mapper] of Object.entries(aiEventMap)) {
    const sub = eventBus.on(eventType as any, (event) => {
      const payload = mapper(event);
      if (payload) {
        log('[EventBridge] AI→Renderer', { eventType, command: payload.command });
        pushManager.pushAiCommand(payload);
      }
    });
    subscriptions.push(sub);
  }

  // ═══ Renderer → Main: forward user action events to EventBus ═══

  const handleUserAction = (_ipcEvent: Electron.IpcMainEvent, payload: UserActionPayload) => {
    log('[EventBridge] Renderer→EventBus', { action: payload.action });
    switch (payload.action) {
      case 'navigate':
        eventBus.emit({
          type: 'user:navigate',
          view: payload.view,
          previousView: payload.previousView,
          ...(payload.target !== undefined && { target: payload.target }),
        });
        break;
      case 'selectPaper':
        eventBus.emit({
          type: 'user:selectPaper',
          paperId: payload.paperId,
          source: payload.source as any,
        });
        break;
      case 'selectConcept':
        eventBus.emit({
          type: 'user:selectConcept',
          conceptId: payload.conceptId,
          source: payload.source as any,
        });
        break;
      case 'selectText':
        eventBus.emit({
          type: 'user:selectText',
          paperId: payload.paperId,
          text: payload.text,
          page: payload.page,
          ...(payload.rect !== undefined && { rect: payload.rect }),
        });
        break;
      case 'highlight':
        eventBus.emit({
          type: 'user:highlight',
          paperId: payload.paperId,
          annotationId: payload.annotationId,
          text: payload.text,
          page: payload.page,
        });
        break;
      case 'openPaper':
        eventBus.emit({
          type: 'user:openPaper',
          paperId: payload.paperId,
          hasPdf: payload.hasPdf,
        });
        break;
      case 'pageChange':
        eventBus.emit({
          type: 'user:pageChange',
          paperId: payload.paperId,
          page: payload.page,
          totalPages: payload.totalPages,
        });
        break;
      case 'search':
        eventBus.emit({
          type: 'user:search',
          query: payload.query,
          scope: payload.scope as any,
        });
        break;
      case 'idle':
        eventBus.emit({
          type: 'user:idle',
          durationMs: payload.durationMs,
          lastView: payload.lastView,
        });
        break;
      case 'import':
        eventBus.emit({
          type: 'user:import',
          format: payload.format as any,
          count: payload.count,
        });
        break;
    }
  };

  ipcMain.on('event:userAction', handleUserAction);

  // Handle suggestion responses
  const handleSuggestionResponse = (_ipcEvent: Electron.IpcMainEvent, suggestionId: string, actionId: string) => {
    log('[EventBridge] SuggestionResponse', { suggestionId, actionId });
    eventBus.emit({
      type: 'user:chat',
      message: `[suggestion:${suggestionId}:${actionId}]`,
      contextKey: 'suggestion',
    });
  };

  ipcMain.on('event:suggestionResponse', handleSuggestionResponse);

  // Return cleanup function
  return () => {
    for (const sub of subscriptions) sub.unsubscribe();
    ipcMain.removeListener('event:userAction', handleUserAction);
    ipcMain.removeListener('event:suggestionResponse', handleSuggestionResponse);
  };
}
