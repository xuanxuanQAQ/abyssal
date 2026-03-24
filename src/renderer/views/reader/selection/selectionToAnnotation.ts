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
  const cleaned = cleanClientRects(selectionRects);

  const normalizedRects: NormalizedRect[] = cleaned.map((rect) => {
    // Convert from viewport coords to PageSlot-relative coords
    const relLeft = rect.left - pageSlotRect.left;
    const relTop = rect.top - pageSlotRect.top;
    const relRight = relLeft + rect.width;
    const relBottom = relTop + rect.height;

    // Convert corners to PDF coords
    const topLeft = domToPDF(relLeft, relTop, inverseTransform);
    const topRight = domToPDF(relRight, relTop, inverseTransform);
    const bottomLeft = domToPDF(relLeft, relBottom, inverseTransform);
    const bottomRight = domToPDF(relRight, relBottom, inverseTransform);

    // Compute bounding box in PDF space
    const pdfMinX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const pdfMaxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const pdfMinY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const pdfMaxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    // Normalize to crop box
    const normTopLeft = pdfToNormalized(pdfMinX, pdfMaxY, cropBox);
    const normBottomRight = pdfToNormalized(pdfMaxX, pdfMinY, cropBox);

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
