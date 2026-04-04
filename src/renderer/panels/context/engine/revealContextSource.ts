import { useAppStore } from '../../../core/store';
import type { ContextSource } from '../../../../shared-types/models';
import { contextSourceKey } from './contextSourceKey';

let revealTimerId: ReturnType<typeof setTimeout> | undefined;
let revealDelayTimerId: ReturnType<typeof setTimeout> | undefined;

export const CONTEXT_PREVIEW_DELAY_MS = 260;
export const CONTEXT_PREVIEW_DWELL_MS = 2600;

interface RevealOptions {
  temporaryMs?: number;
  delayMs?: number;
}

function applyReveal(source: ContextSource, options: RevealOptions): void {
  clearTimeout(revealTimerId);

  const state = useAppStore.getState();
  if (!state.contextPanelOpen) {
    useAppStore.setState({
      contextPanelOpen: true,
      contextPanelSize: state.contextPanelLastSize || 28,
    });
  }

  state.setPeekSource(source);

  if (!options.temporaryMs || options.temporaryMs <= 0) {
    return;
  }

  const sourceKey = contextSourceKey(source);
  revealTimerId = setTimeout(() => {
    const currentState = useAppStore.getState();
    if (currentState.contextPanelPinned) return;
    if (currentState.peekSource && contextSourceKey(currentState.peekSource) === sourceKey) {
      currentState.setPeekSource(null);
    }
  }, options.temporaryMs);
}

export function revealContextSource(source: ContextSource, options: RevealOptions = {}): void {
  clearTimeout(revealDelayTimerId);

  if (options.delayMs && options.delayMs > 0) {
    revealDelayTimerId = setTimeout(() => {
      applyReveal(source, options);
    }, options.delayMs);
    return;
  }

  applyReveal(source, options);
}

export function previewContextSource(source: ContextSource, options: RevealOptions = {}): void {
  revealContextSource(source, {
    delayMs: options.delayMs ?? CONTEXT_PREVIEW_DELAY_MS,
    temporaryMs: options.temporaryMs ?? CONTEXT_PREVIEW_DWELL_MS,
  });
}

export function cancelPendingContextReveal(): void {
  clearTimeout(revealDelayTimerId);
}

export function clearRevealedContext(): void {
  clearTimeout(revealDelayTimerId);
  clearTimeout(revealTimerId);
  useAppStore.getState().setPeekSource(null);
}