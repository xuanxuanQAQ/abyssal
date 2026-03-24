import React, { useMemo } from 'react';
import type { Annotation } from '../../../../../shared-types/models';
import type { CropBox } from '../../math/normalizedCoords';
import { rectNormalizedToPDF } from '../../math/normalizedCoords';
import { pdfToDOM } from '../../math/coordinateTransform';
import type { Transform6 } from '../../math/coordinateTransform';

export interface AnnotationLayerProps {
  pageNumber: number;
  cssWidth: number;
  cssHeight: number;
  annotations: Annotation[];
  transform: Transform6;
  cropBox: CropBox;
  flashingAnnotationId: string | null;
  onAnnotationHover: (id: string | null) => void;
  onAnnotationClick: (id: string) => void;
}

import { HIGHLIGHT_COLOR_MAP as HIGHLIGHT_COLORS } from '../../shared/highlightColors';

interface ComputedRect {
  annotationId: string;
  annotationType: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Annotation overlay layer (z-index: 2).
 * Renders highlight/note/conceptTag divs with mix-blend-mode: multiply.
 */
const AnnotationLayer = React.memo(function AnnotationLayer(
  props: AnnotationLayerProps,
) {
  const {
    cssWidth,
    cssHeight,
    annotations,
    transform,
    cropBox,
    flashingAnnotationId,
    onAnnotationHover,
    onAnnotationClick,
  } = props;

  const computedRects = useMemo(() => {
    const result: ComputedRect[] = [];

    for (const annotation of annotations) {
      if (!annotation.position?.rects) continue;

      const color =
        HIGHLIGHT_COLORS[annotation.color] ?? HIGHLIGHT_COLORS['yellow']!;

      for (const rect of annotation.position.rects) {
        // Normalized rect → PDF rect (CropBox-aware)
        const pdfRect = rectNormalizedToPDF(rect, cropBox);

        // PDF → DOM: convert top-left and bottom-right corners
        const topLeft = pdfToDOM(pdfRect.x, pdfRect.y, transform);
        const bottomRight = pdfToDOM(
          pdfRect.x + pdfRect.width,
          pdfRect.y + pdfRect.height,
          transform,
        );

        // In DOM space, y might be flipped, so normalize
        const domX = Math.min(topLeft.x, bottomRight.x);
        const domY = Math.min(topLeft.y, bottomRight.y);
        const domW = Math.abs(bottomRight.x - topLeft.x);
        const domH = Math.abs(bottomRight.y - topLeft.y);

        result.push({
          annotationId: annotation.id,
          annotationType: annotation.type,
          color,
          x: domX,
          y: domY,
          width: domW,
          height: domH,
        });
      }
    }

    return result;
  }, [annotations, transform, cropBox]);

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: cssWidth,
        height: cssHeight,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {computedRects.map((rect, index) => {
        const isFlashing = flashingAnnotationId === rect.annotationId;

        return (
          <div
            key={`${rect.annotationId}-${index}`}
            data-annotation-id={rect.annotationId}
            data-annotation-type={rect.annotationType}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              mixBlendMode: 'multiply',
              background: rect.color,
              pointerEvents: 'auto',
              cursor: 'pointer',
              borderRadius: 2,
              opacity: isFlashing ? 0.8 : undefined,
            }}
            onMouseEnter={() => onAnnotationHover(rect.annotationId)}
            onMouseLeave={() => onAnnotationHover(null)}
            onClick={() => onAnnotationClick(rect.annotationId)}
          />
        );
      })}
    </div>
  );
});

export { AnnotationLayer };
