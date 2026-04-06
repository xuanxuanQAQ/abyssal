import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveExtractionMethod } from './extraction-method';
import { resolveOcrRuntimePaths } from './extract-text';

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

describe('resolveOcrRuntimePaths', () => {
  it('prefers source-relative worker and repo assets when running from source', () => {
    const baseDir = path.join('repo', 'src', 'core', 'process');
    const resourcesPath = path.join('repo', 'resources');
    const existing = new Set([
      path.resolve(baseDir, 'tesseract-worker.cjs'),
      path.resolve(baseDir, '..', '..', '..', 'assets', 'tesseract'),
    ]);

    const resolved = resolveOcrRuntimePaths(baseDir, resourcesPath, (target) => existing.has(target));

    expect(resolved.workerPath).toBe(path.resolve(baseDir, 'tesseract-worker.cjs'));
    expect(resolved.langDir).toBe(path.resolve(baseDir, '..', '..', '..', 'assets', 'tesseract'));
  });

  it('falls back to packaged resources when repo assets are unavailable', () => {
    const baseDir = path.join('repo', 'dist', 'electron');
    const resourcesPath = path.join('repo', 'release-resources');
    const existing = new Set([
      path.resolve(baseDir, '..', 'core', 'process', 'tesseract-worker.cjs'),
      path.join(resourcesPath, 'tesseract'),
    ]);

    const resolved = resolveOcrRuntimePaths(baseDir, resourcesPath, (target) => existing.has(target));

    expect(resolved.workerPath).toBe(path.resolve(baseDir, '..', 'core', 'process', 'tesseract-worker.cjs'));
    expect(resolved.langDir).toBe(path.join(resourcesPath, 'tesseract'));
  });
});