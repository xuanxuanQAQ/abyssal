import React, { useEffect } from 'react';
import { CanvasLayer } from './layers/CanvasLayer';
import { TextLayer } from './layers/TextLayer';
import { OcrTextLayer } from './layers/OcrTextLayer';
import { AnnotationLayer } from './layers/AnnotationLayer';
import { BlockOverlayLayer } from './layers/BlockOverlayLayer';
import { InteractionLayer } from './layers/InteractionLayer';
import type { Annotation, ContentBlockDTO, OcrLineDTO } from '../../../../shared-types/models';
import type { PageMetadata } from '../core/pageMetadataPreloader';
import type { Transform6 } from '../math/coordinateTransform';
import type { MemoryBudget } from '../core/memoryBudget';
import type { ColumnBounds } from '../selection/dragEnvelope';

/**
 * Minimum average OCR confidence (0-100) to use OcrTextLayer.
 * Raised to reduce visibly misaligned OCR text overlays on low-quality pages.
 */
const OCR_CONFIDENCE_THRESHOLD = 55;

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
  ) => { promise: Promise<void>; cancel: () => void };
  getPage: (pageNumber: number) => Promise<any>;
  onAreaSelect: (
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onAnnotationHover: (id: string | null) => void;
  onAnnotationClick: (id: string) => void;
  memoryBudget?: MemoryBudget;
  /** DLA content blocks for this page */
  blocks?: ContentBlockDTO[];
  /** OCR line-level bbox data for scanned pages (replaces pdf.js TextLayer) */
  ocrLines?: OcrLineDTO[];
  onBlockSelect?: (block: ContentBlockDTO) => void;
  /** DLA highlight bounds from DragEnvelope for this page */
  dragBounds?: ColumnBounds[] | undefined;
}

/**
 * Single page container with 5-layer stack + placeholder logic.
 * z-index 0: CanvasLayer, 1: AnnotationLayer, 2: TextLayer, 3: BlockOverlayLayer, 4: InteractionLayer
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
    blocks = [],
    ocrLines,
    onBlockSelect,
    dragBounds,
  } = props;

  const [ocrDisabledByMismatch, setOcrDisabledByMismatch] = React.useState(false);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const cssWidth = metadata.baseWidth * scale;
  const cssHeight = metadata.baseHeight * scale;
  const canvasWidth = Math.floor(cssWidth * dpr);
  const canvasHeight = Math.floor(cssHeight * dpr);

  // Use OcrTextLayer only when OCR data exists and average confidence is above threshold,
  // AND geometry alignment check passes
  const useOcrLayer = (() => {
    if (!ocrLines || ocrLines.length === 0) {
      return false;
    }
    if (ocrDisabledByMismatch) {
      return false;
    }
    const avg = ocrLines.reduce((sum, l) => sum + l.confidence, 0) / ocrLines.length;
    const shouldUse = avg >= OCR_CONFIDENCE_THRESHOLD;
    return shouldUse;
  })();

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

  // Full render → all 5 layers
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
      {useOcrLayer ? (
        <OcrTextLayer
          pageNumber={pageNumber}
          cssWidth={cssWidth}
          cssHeight={cssHeight}
          isInRenderWindow={true}
          ocrLines={ocrLines ?? []}
          blocks={blocks}
          {...(onBlockSelect ? { onBlockClick: onBlockSelect } : {})}
          dragBounds={dragBounds}
          onGeometryMismatch={() => setOcrDisabledByMismatch(true)}
        />
      ) : (
        <TextLayer
          pageNumber={pageNumber}
          cssWidth={cssWidth}
          cssHeight={cssHeight}
          scale={scale}
          getPage={getPage}
          isInRenderWindow={true}
          blocks={blocks}
          {...(onBlockSelect ? { onBlockClick: onBlockSelect } : {})}
          dragBounds={dragBounds}
        />
      )}
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
      <BlockOverlayLayer
        pageNumber={pageNumber}
        cssWidth={cssWidth}
        cssHeight={cssHeight}
        blocks={blocks}
        {...(onBlockSelect ? { onBlockSelect } : {})}
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
