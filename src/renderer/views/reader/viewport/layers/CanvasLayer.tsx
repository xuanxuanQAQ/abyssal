import React, { useRef, useEffect, useCallback } from 'react';

export interface CanvasLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  scale: number;
  renderPage: (
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    dpr: number,
  ) => Promise<void>;
  isInRenderWindow: boolean;
}

/**
 * Canvas rendering layer (z-index: 0).
 * Implements double-buffering for smooth zoom transitions (§14.3).
 */
const CanvasLayer = React.memo(function CanvasLayer(props: CanvasLayerProps) {
  const {
    pageNumber,
    cssWidth,
    cssHeight,
    canvasWidth,
    canvasHeight,
    dpr,
    scale,
    renderPage,
    isInRenderWindow,
  } = props;

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<'a' | 'b'>('a');
  const previousScaleRef = useRef<number>(scale);
  const isRenderingRef = useRef(false);
  const wasInRenderWindowRef = useRef(isInRenderWindow);

  const getActiveCanvas = useCallback(() => {
    return activeCanvasRef.current === 'a' ? canvasARef.current : canvasBRef.current;
  }, []);

  const getBackgroundCanvas = useCallback(() => {
    return activeCanvasRef.current === 'a' ? canvasBRef.current : canvasARef.current;
  }, []);

  useEffect(() => {
    if (!isInRenderWindow) {
      return;
    }

    if (isRenderingRef.current) {
      return;
    }

    const backgroundCanvas = getBackgroundCanvas();
    const activeCanvas = getActiveCanvas();

    if (!backgroundCanvas || !activeCanvas) {
      return;
    }

    const prevScale = previousScaleRef.current;
    const scaleChanged = prevScale !== scale;

    // If scale changed, apply CSS transform to the active (visible) canvas
    // so the user sees an immediate (blurry) zoom while we re-render
    if (scaleChanged && activeCanvas.style.display !== 'none') {
      const ratio = scale / prevScale;
      activeCanvas.style.transformOrigin = '0 0';
      activeCanvas.style.transform = `scale(${ratio})`;
    }

    // Set physical dimensions on the background canvas
    backgroundCanvas.width = canvasWidth;
    backgroundCanvas.height = canvasHeight;
    backgroundCanvas.style.width = `${cssWidth}px`;
    backgroundCanvas.style.height = `${cssHeight}px`;

    isRenderingRef.current = true;

    renderPage(backgroundCanvas, pageNumber, scale, dpr)
      .then(() => {
        // Clear any CSS transform on the old active canvas
        activeCanvas.style.transform = '';
        activeCanvas.style.transformOrigin = '';

        // Swap: show background, hide old active
        activeCanvas.style.display = 'none';
        backgroundCanvas.style.display = 'block';

        // Flip active marker
        activeCanvasRef.current = activeCanvasRef.current === 'a' ? 'b' : 'a';
        previousScaleRef.current = scale;
      })
      .finally(() => {
        isRenderingRef.current = false;
      });
  }, [
    isInRenderWindow,
    scale,
    canvasWidth,
    canvasHeight,
    cssWidth,
    cssHeight,
    dpr,
    pageNumber,
    renderPage,
    getActiveCanvas,
    getBackgroundCanvas,
  ]);

  // §5.3: Release canvas GPU backing store when page leaves render window.
  // Setting width=0 forces the browser to deallocate the bitmap.
  useEffect(() => {
    const wasIn = wasInRenderWindowRef.current;
    wasInRenderWindowRef.current = isInRenderWindow;

    if (wasIn && !isInRenderWindow) {
      // Leaving render window — release canvas memory
      for (const ref of [canvasARef, canvasBRef]) {
        const canvas = ref.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }
  }, [isInRenderWindow]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const ref of [canvasARef, canvasBRef]) {
        const canvas = ref.current;
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    };
  }, []);

  if (!isInRenderWindow) {
    return null;
  }

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
  };

  return (
    <>
      <canvas
        ref={canvasARef}
        style={{
          ...canvasStyle,
          display: activeCanvasRef.current === 'a' ? 'block' : 'none',
          width: cssWidth,
          height: cssHeight,
        }}
        width={canvasWidth}
        height={canvasHeight}
      />
      <canvas
        ref={canvasBRef}
        style={{
          ...canvasStyle,
          display: activeCanvasRef.current === 'b' ? 'block' : 'none',
          width: cssWidth,
          height: cssHeight,
        }}
        width={canvasWidth}
        height={canvasHeight}
      />
    </>
  );
});

export { CanvasLayer };
