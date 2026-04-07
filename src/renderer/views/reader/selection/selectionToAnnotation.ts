import { cleanClientRects } from '../math/rectNormalization';
import { domToPDF } from '../math/inverseTransform';
import { pdfToNormalized } from '../math/normalizedCoords';
import type { CropBox } from '../math/normalizedCoords';
import type { Transform6 } from '../math/coordinateTransform';
import type { AnnotationPosition } from '../../../../shared-types/models';

interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function selectionToAnnotationPosition(
  selectionRects: DOMRect[],
  pageSlotRect: DOMRect,
  inverseTransform: Transform6,
  cropBox: CropBox,
): AnnotationPosition {
  // Transform raw rects to PDF space first, then clean in PDF space.
  // This avoids the coordinate mismatch where cleaning modifies DOM positions
  // before transformation, causing annotations to be spatially offset.
  const pdfRects = selectionRects.map((rect) => {
    const relLeft = rect.left - pageSlotRect.left;
    const relTop = rect.top - pageSlotRect.top;
    const relRight = relLeft + rect.width;
    const relBottom = relTop + rect.height;

    const topLeft = domToPDF(relLeft, relTop, inverseTransform);
    const topRight = domToPDF(relRight, relTop, inverseTransform);
    const bottomLeft = domToPDF(relLeft, relBottom, inverseTransform);
    const bottomRight = domToPDF(relRight, relBottom, inverseTransform);

    const pdfMinX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const pdfMaxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const pdfMinY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const pdfMaxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    return new DOMRect(pdfMinX, pdfMinY, pdfMaxX - pdfMinX, pdfMaxY - pdfMinY);
  });

  // Clean (row-align + gap-bridge) in PDF coordinate space
  const cleaned = cleanClientRects(pdfRects);

  const normalizedRects: NormalizedRect[] = cleaned.map((rect) => {
    // Now normalize cleaned PDF rects to crop box
    const normTopLeft = pdfToNormalized(rect.left, rect.bottom, cropBox);
    const normBottomRight = pdfToNormalized(rect.right, rect.top, cropBox);

    return {
      x: normTopLeft.x,
      y: normTopLeft.y,
      width: normBottomRight.x - normTopLeft.x,
      height: normBottomRight.y - normTopLeft.y,
    };
  });

  const pageWidth = cropBox.maxX - cropBox.minX;
  const pageHeight = cropBox.maxY - cropBox.minY;

  return {
    rects: normalizedRects,
    pageWidth,
    pageHeight,
    coordinateSystem: 'pdf_points' as const,
  };
}
