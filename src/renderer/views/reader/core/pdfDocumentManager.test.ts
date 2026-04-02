import { describe, expect, it } from 'vitest';
import { filePathToPdfJsUrl } from './pdfDocumentManager';

describe('filePathToPdfJsUrl', () => {
  it('converts Windows paths to encoded file URLs for pdf.js', () => {
    expect(filePathToPdfJsUrl('C:\\Users\\xuan xuan\\papers\\sample file.pdf')).toBe(
      'file:///C:/Users/xuan%20xuan/papers/sample%20file.pdf',
    );
  });
});