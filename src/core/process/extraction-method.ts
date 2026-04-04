import type { TextExtractionResult } from './types';

export function deriveExtractionMethod(
  pageCount: number,
  scannedPageCount: number,
  ocrAppliedPageCount: number,
): TextExtractionResult['method'] {
  if (ocrAppliedPageCount <= 0) {
    return 'mupdf';
  }

  if (ocrAppliedPageCount >= pageCount && scannedPageCount >= pageCount) {
    return 'ocr';
  }

  return 'mupdf+ocr';
}