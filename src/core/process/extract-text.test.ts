import { describe, expect, it } from 'vitest';
import { deriveExtractionMethod } from './extraction-method';

describe('deriveExtractionMethod', () => {
  it('returns mupdf when OCR never produced accepted pages', () => {
    expect(deriveExtractionMethod(10, 4, 0)).toBe('mupdf');
  });

  it('returns ocr only when every page was scanned and OCR accepted all pages', () => {
    expect(deriveExtractionMethod(3, 3, 3)).toBe('ocr');
  });

  it('returns mupdf+ocr for mixed extraction results', () => {
    expect(deriveExtractionMethod(8, 5, 2)).toBe('mupdf+ocr');
  });
});