// ═══ PDF 有效性校验 ═══
// §8: 魔数 → mupdf.js → 页数 三步管线

import * as fs from 'node:fs';
import type { PdfValidation } from '../types';
import { PdfCorruptedError } from '../types/errors';

// PDF 魔数: %PDF-
// Adobe 规范允许 %PDF- 出现在前 1024 字节中的任意位置
// （BOM、空白符、HTTP 头残余等可能出现在文件开头）
const PDF_MAGIC_STR = '%PDF-';
const MAGIC_SCAN_BYTES = 1024;

/**
 * 三步 PDF 校验管线。
 *
 * 1. 魔数检测（前 1024 字节内含 %PDF-）
 * 2. mupdf.js 打开测试
 * 3. 页数 > 0
 */
export async function validatePdf(filePath: string): Promise<PdfValidation> {
  const stat = fs.statSync(filePath);
  const fileSizeBytes = stat.size;
  const base: Omit<PdfValidation, 'valid' | 'reason' | 'pageCount'> = {
    fileSizeBytes,
  };

  // 步骤 1：魔数检测（扫描前 1024 字节）
  if (fileSizeBytes < 5) {
    return { ...base, valid: false, reason: 'File too small (< 5 bytes)', pageCount: null };
  }

  const scanSize = Math.min(MAGIC_SCAN_BYTES, fileSizeBytes);
  const fd = fs.openSync(filePath, 'r');
  const headerBuf = Buffer.alloc(scanSize);
  fs.readSync(fd, headerBuf, 0, scanSize, 0);
  fs.closeSync(fd);

  if (!headerBuf.includes(PDF_MAGIC_STR)) {
    return { ...base, valid: false, reason: 'No %PDF- signature found in first 1024 bytes', pageCount: null };
  }

  // 步骤 2+3：mupdf.js 打开测试 + 页数检查
  // Fix: 统一 try-finally，确保 doc 在任何异常路径都被 destroy
  let doc: { countPages(): number; destroy?(): void } | null = null;
  try {
    // mupdf 的导入方式取决于包版本；兼容多种导入路径
    let mupdf: { Document: { openDocument(data: Buffer | ArrayBuffer, magic: string): unknown } };
    try {
      mupdf = await import('mupdf');
    } catch {
      try {
        mupdf = await import('mupdf/dist/mupdf.js' as string);
      } catch {
        // mupdf 不可用——跳过步骤 2 和 3，仅依赖魔数检测
        return { ...base, valid: true, reason: null, pageCount: null };
      }
    }

    const buffer = fs.readFileSync(filePath);
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as typeof doc;

    const pageCount = doc!.countPages();
    if (pageCount === 0) {
      return { ...base, valid: false, reason: 'PDF has zero pages', pageCount: 0 };
    }
    return { ...base, valid: true, reason: null, pageCount };
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.toLowerCase().includes('password')) {
      return { ...base, valid: false, reason: 'PDF is encrypted/password-protected', pageCount: null };
    }
    return { ...base, valid: false, reason: `PDF parse failure: ${msg}`, pageCount: null };
  } finally {
    if (doc) (doc as { destroy?(): void }).destroy?.();
  }
}
