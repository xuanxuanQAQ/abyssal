import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HeatmapCell } from '../../../../../../shared-types/models';
import { cellKey } from '../../../shared/cellKey';
import { HeatmapGrid } from './HeatmapGrid';

const resizeObserverState = vi.hoisted(() => ({
  callback: null as ResizeObserverCallback | null,
}));

const canvasContextMock = vi.hoisted(() => ({
  save: vi.fn(),
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  scale: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  setLineDash: vi.fn(),
  restore: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: 'left' as CanvasTextAlign,
  textBaseline: 'alphabetic' as CanvasTextBaseline,
}));

describe('HeatmapGrid', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    resizeObserverState.callback = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverState.callback = callback;
      }

      observe(target: Element) {
        resizeObserverState.callback?.([
          {
            target,
            contentRect: { width: 480, height: 320 } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ], this as unknown as ResizeObserver);
      }

      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContextMock as unknown as CanvasRenderingContext2D);

    container = document.createElement('div');
    container.style.width = '640px';
    container.style.height = '480px';
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('mounts the main matrix canvas inside the grid viewport', () => {
    const cellLookup = new Map<string, HeatmapCell>();
    cellLookup.set(cellKey(0, 0), {
      conceptIndex: 0,
      paperIndex: 0,
      relationType: 'supports',
      confidence: 0.92,
      mappingId: 'mapping-1',
      adjudicationStatus: 'pending',
    });

    act(() => {
      root.render(
        <HeatmapGrid
          paperIds={['paper-1']}
          paperLabels={['Paper One']}
          concepts={[
            { id: 'concept-1', name: 'Concept One', parentId: null, level: 0 },
          ]}
          groups={[
            { id: 'concept-1', name: 'Concept One', conceptIds: ['concept-1'] },
          ]}
          collapsedGroups={new Set()}
          onToggleGroup={() => {}}
          hoveredCell={null}
          selectedCell={null}
          onHoverCell={() => {}}
          onHoverPositionChange={() => {}}
          onSelectCell={() => {}}
          onOpenCellMenu={() => {}}
          showGrid={false}
          rowOffsets={[0]}
          totalContentHeight={18}
          cellLookup={cellLookup}
        />,
      );
    });

    const canvas = container.querySelector('canvas[role="grid"][aria-label="概念-论文映射热力图"]');

    expect(canvas).not.toBeNull();
  });
});