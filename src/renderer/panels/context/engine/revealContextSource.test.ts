import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../core/store/useAppStore';
import {
  cancelPendingContextReveal,
  clearRevealedContext,
  CONTEXT_PREVIEW_DELAY_MS,
  CONTEXT_PREVIEW_DWELL_MS,
  previewContextSource,
  revealContextSource,
} from './revealContextSource';

describe('revealContextSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRevealedContext();
    useAppStore.setState({
      contextPanelOpen: false,
      contextPanelSize: 0,
      contextPanelLastSize: 31,
      contextPanelPinned: false,
      pinnedSource: null,
      peekSource: null,
    });
  });

  afterEach(() => {
    clearRevealedContext();
    vi.useRealTimers();
  });

  it('reveals preview after delay and clears it after dwell timeout', () => {
    previewContextSource({ type: 'memo', memoId: 'memo-1' });

    expect(useAppStore.getState().contextPanelOpen).toBe(false);
    expect(useAppStore.getState().peekSource).toBeNull();

    vi.advanceTimersByTime(CONTEXT_PREVIEW_DELAY_MS);

    expect(useAppStore.getState().contextPanelOpen).toBe(true);
    expect(useAppStore.getState().contextPanelSize).toBe(31);
    expect(useAppStore.getState().peekSource).toEqual({ type: 'memo', memoId: 'memo-1' });

    vi.advanceTimersByTime(CONTEXT_PREVIEW_DWELL_MS);

    expect(useAppStore.getState().peekSource).toBeNull();
  });

  it('cancels delayed preview before it becomes visible', () => {
    previewContextSource({ type: 'note', noteId: 'note-1' });
    cancelPendingContextReveal();

    vi.advanceTimersByTime(CONTEXT_PREVIEW_DELAY_MS + CONTEXT_PREVIEW_DWELL_MS);

    expect(useAppStore.getState().contextPanelOpen).toBe(false);
    expect(useAppStore.getState().peekSource).toBeNull();
  });

  it('keeps preview visible when the panel is pinned before timeout', () => {
    revealContextSource({ type: 'memo', memoId: 'memo-2' }, { temporaryMs: 1000 });
    useAppStore.setState({ contextPanelPinned: true });

    vi.advanceTimersByTime(1000);

    expect(useAppStore.getState().peekSource).toEqual({ type: 'memo', memoId: 'memo-2' });
  });
});