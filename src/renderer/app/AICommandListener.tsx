/**
 * AICommandListener — invisible component that reacts to AI command events.
 *
 * Sits in the App component tree and translates AI commands
 * (from the SessionOrchestrator via push:aiCommand) into Zustand store mutations.
 *
 * This is the renderer-side counterpart to the EventBridge:
 *   SessionOrchestrator → EventBus → EventBridge → push:aiCommand → AICommandListener → Store
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../core/store';
import toast from 'react-hot-toast';
import type { AICommandPayload } from '../../shared-types/ipc/contract';

export function AICommandListener() {
  const switchView = useAppStore((s) => s.switchView);
  const selectPaper = useAppStore((s) => s.selectPaper);
  const selectConcept = useAppStore((s) => s.selectConcept);
  const selectNote = useAppStore((s) => s.selectNote);

  // Track active suggestions
  const activeSuggestions = useRef<Map<string, AICommandPayload & { command: 'suggest' }>>(new Map());

  const handleCommand = useCallback((payload: AICommandPayload) => {
    switch (payload.command) {
      case 'navigate': {
        switchView(payload.view);
        if (payload.target?.paperId) selectPaper(payload.target.paperId);
        if (payload.target?.conceptId) selectConcept(payload.target.conceptId);
        if (payload.target?.noteId) selectNote(payload.target.noteId);
        break;
      }

      case 'focusEntity': {
        // Navigate to the appropriate view and select the entity
        switch (payload.entityType) {
          case 'paper':
            selectPaper(payload.entityId);
            break;
          case 'concept':
            selectConcept(payload.entityId);
            break;
          case 'note':
            selectNote(payload.entityId);
            break;
        }
        break;
      }

      case 'notify': {
        const toastFn = payload.level === 'success' ? toast.success
          : payload.level === 'warning' ? toast.error
          : toast;
        toastFn(`${payload.title}: ${payload.message}`, { duration: 5000 });
        break;
      }

      case 'suggest': {
        const { suggestion } = payload;
        activeSuggestions.current.set(suggestion.id, payload);

        // Show suggestion as a toast with action buttons
        toast(
          (t) => {
            const handleAction = (actionId: string) => {
              toast.dismiss(t.id);
              activeSuggestions.current.delete(suggestion.id);
              // Forward to main process
              (window as any).abyssal?.event?.suggestionResponse?.(suggestion.id, actionId);
            };

            return (
              <div style={{ maxWidth: 320 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{suggestion.title}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>{suggestion.description}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {suggestion.actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleAction(action.id)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: action.primary ? 600 : 400,
                        background: action.primary ? 'var(--color-primary, #4f46e5)' : 'var(--color-surface-2, #e5e7eb)',
                        color: action.primary ? '#fff' : 'inherit',
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          },
          {
            duration: suggestion.dismissAfterMs || Infinity,
            position: 'bottom-right',
          },
        );
        break;
      }

      case 'highlightPassage': {
        // This will be handled by the ReaderView component via a separate hook
        // Dispatch a custom DOM event that the reader can listen to
        window.dispatchEvent(new CustomEvent('ai:highlightPassage', { detail: payload }));
        break;
      }

      case 'showComparison': {
        // Dispatch for the comparison panel to pick up
        window.dispatchEvent(new CustomEvent('ai:showComparison', { detail: payload }));
        break;
      }

      case 'updateSettings': {
        // Settings updates are handled on the main process side
        // Just show a notification here
        toast(`Settings updated: ${payload.section}`, { icon: '\u2699\uFE0F', duration: 3000 });
        break;
      }
    }
  }, [switchView, selectPaper, selectConcept, selectNote]);

  useEffect(() => {
    const unsub = (window as any).abyssal?.on?.aiCommand?.(handleCommand);
    return () => unsub?.();
  }, [handleCommand]);

  // This component renders nothing
  return null;
}
