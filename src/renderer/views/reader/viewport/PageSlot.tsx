import React, { useRef, useEffect } from 'react';
import { CanvasLayer } from './layers/CanvasLayer';
import { TextLayer } from './layers/TextLayer';
import { AnnotationLayer } from './layers/AnnotationLayer';
import { InteractionLayer } from './layers/InteractionLayer';
import type { Annotation } from '../../../../shared-types/models';
import type { PageMetadata } from '../core/pageMetadataPreloader';
import type { Transform6 } from '../math/coordinateTransform';
import type { MemoryBudget } from '../core/memoryBudget';

export interface PageSlotProps {
  pageNumber: number;
  metadata: PageMetadata;
  scale: number;
  isInFullRender: boolean;
  isInCache: boolean;
  annotations: Annotation[];
  transform: Transform6;
  flashingAnnotationId: string | null;
  renderPage: (
    canvas: HTMLCanvasElement,
    pageNumber: number,
    scale: number,
    dpr: number,
  ) => Promise<void>;
  getPage: (pageNumber: number) => Promise<any>;
  onAreaSelect: (
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onAnnotationHover: (id: string | null) => void;
  onAnnotationClick: (id: string) => void;
  memoryBudget?: MemoryBudget;
}

/**
 * Single page container with 4-layer stack + placeholder logic.
 * z-index 0: CanvasLayer, 1: TextLayer, 2: AnnotationLayer, 3: InteractionLayer
 */
const PageSlot = React.memo(function PageSlot(props: PageSlotProps) {
  const {
    pageNumber,
    metadata,
    scale,
    isInFullRender,
    isInCache,
    annotations,
    transform,
    flashingAnnotationId,
    renderPage,
    getPage,
    onAreaSelect,
    onAnnotationHover,
    onAnnotationClick,
    memoryBudget,
  } = props;

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const cssWidth = metadata.baseWidth * scale;
  const cssHeight = metadata.baseHeight * scale;
  const canvasWidth = Math.floor(cssWidth * dpr);
  const canvasHeight = Math.floor(cssHeight * dpr);

  // Register/unregister canvas pixels for memory budget tracking
  useEffect(() => {
    if (isInCache && memoryBudget) {
      memoryBudget.registerCanvas(pageNumber, canvasWidth, canvasHeight);
      return () => {
        memoryBudget.unregisterCanvas(pageNumber);
      };
    }
  }, [isInCache, pageNumber, canvasWidth, canvasHeight, memoryBudget]);

  // Not in cache range → placeholder
  if (!isInCache) {
    return (
      <div
        data-page={pageNumber}
        style={{
          position: 'relative',
          width: cssWidth,
          height: cssHeight,
          margin: '0 auto',
          background: 'var(--bg-surface-low)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            userSelect: 'none',
          }}
        >
          Page {pageNumber}
        </span>
      </div>
    );
  }

  // In cache but not full render → CanvasLayer only
  if (!isInFullRender) {
    return (
      <div
        data-page={pageNumber}
        style={{
          position: 'relative',
          width: cssWidth,
          height: cssHeight,
          margin: '0 auto',
        }}
      >
        <CanvasLayer
          pageNumber={pageNumber}
          cssWidth={cssWidth}
          cssHeight={cssHeight}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          dpr={dpr}
          scale={scale}
          renderPage={renderPage}
          isInRenderWindow={true}
        />
      </div>
    );
  }

  // Full render → all 4 layers
  return (
    <div
      data-page={pageNumber}
      style={{
        position: 'relative',
        width: cssWidth,
        height: cssHeight,
        margin: '0 auto',
      }}
    >
      <CanvasLayer
        pageNumber={pageNumber}
        cssWidth={cssWidth}
        cssHeight={cssHeight}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        dpr={dpr}
        scale={scale}
        renderPage={renderPage}
        isInRenderWindow={true}
      />
      <TextLayer
        pageNumber={pageNumber}
        cssWidth={cssWidth}
        cssHeight={cssHeight}
        scale={scale}
        getPage={getPage}
        isInRenderWindow={true}
      />
      <AnnotationLayer
        pageNumber={pageNumber}
        cssWidth={cssWidth}
        cssHeight={cssHeight}
        annotations={annotations}
        transform={transform}
        cropBox={metadata.cropBox}
        flashingAnnotationId={flashingAnnotationId}
        onAnnotationHover={onAnnotationHover}
        onAnnotationClick={onAnnotationClick}
      />
      <InteractionLayer
        pageNumber={pageNumber}
        cssWidth={cssWidth}
        cssHeight={cssHeight}
        onAreaSelect={onAreaSelect}
      />
    </div>
  );
});

export { PageSlot };
