// ═══ 混合文本提取引擎 ═══
// §1: mupdf.js 结构化提取 → 扫描件检测 → OCR 降级
//
// 改进：保留字体元数据（大小/名称）供 extractSections 用于节标题识别，
// 避免纯正则误将有序列表误判为节标题。

import * as fs from 'node:fs';
import type { TextExtractionResult } from '../types';
import { PdfCorruptedError, ProcessError, OcrFailedError } from '../types/errors';
import { countTokens, estimateTokens } from '../infra/token-counter';

// ─── 带样式的行信息（供 extractSections 使用） ───

export interface StyledLine {
  text: string;
  fontSize: number;   // 该行主要字体大小（取众数）
  isBold: boolean;    // 字体名称含 Bold/bold
  pageIndex: number;
}

// ─── mupdf.js 懒加载 ───

let mupdfModule: typeof import('mupdf') | null = null;

async function getMupdf(): Promise<typeof import('mupdf')> {
  if (mupdfModule) return mupdfModule;
  try {
    mupdfModule = await import('mupdf');
  } catch {
    try {
      mupdfModule = await import('mupdf/dist/mupdf.js' as string);
    } catch (err) {
      throw new ProcessError({
        message: `Failed to load mupdf.js: ${(err as Error).message}`,
        cause: err as Error,
      });
    }
  }
  return mupdfModule!;
}

// ─── 工具：数组众数 ───

function mode(arr: number[]): number {
  const freq = new Map<number, number>();
  let maxCount = 0;
  let maxVal = 0;
  for (const v of arr) {
    const rounded = Math.round(v * 10) / 10; // 四舍五入到0.1
    const c = (freq.get(rounded) ?? 0) + 1;
    freq.set(rounded, c);
    if (c > maxCount) { maxCount = c; maxVal = rounded; }
  }
  return maxVal;
}

// ─── tesseract.js 懒加载 Scheduler + Worker Pool (Fix #2) ───

let ocrScheduler: {
  addWorker(worker: unknown): void;
  addJob(method: string, ...args: unknown[]): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
} | null = null;

/** 序列化初始化锁——防止并发 extractText 创建重复 Worker Pool */
let ocrInitPromise: Promise<typeof ocrScheduler> | null = null;

const OCR_POOL_SIZE = Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4);

async function getOcrScheduler(
  languages: string[],
): Promise<typeof ocrScheduler> {
  if (ocrScheduler) return ocrScheduler;

  // Fix: 使用初始化锁防止并发竞争
  if (ocrInitPromise) return ocrInitPromise;

  ocrInitPromise = (async () => {
    const createdWorkers: unknown[] = [];
    try {
      const Tesseract = await import('tesseract.js');
      const scheduler = Tesseract.createScheduler();
      // 创建 Worker Pool（Fix: 追踪已创建 worker，失败时清理）
      for (let i = 0; i < OCR_POOL_SIZE; i++) {
        const worker = await Tesseract.createWorker(languages.join('+'));
        createdWorkers.push(worker);
        scheduler.addWorker(worker);
      }
      ocrScheduler = scheduler as unknown as typeof ocrScheduler;
      return ocrScheduler;
    } catch (err) {
      // Fix: 清理已创建但未归入 scheduler 的 worker
      for (const w of createdWorkers) {
        try { await (w as { terminate(): Promise<void> }).terminate(); } catch { /* ignore */ }
      }
      throw new OcrFailedError({
        message: `Failed to initialize OCR scheduler: ${(err as Error).message}`,
        cause: err as Error,
      });
    } finally {
      ocrInitPromise = null;
    }
  })();

  return ocrInitPromise;
}

/** 应用退出时调用，释放全部 OCR Workers */
export async function terminateOcrWorker(): Promise<void> {
  if (ocrScheduler) {
    await ocrScheduler.terminate();
    ocrScheduler = null;
  }
}

// ─── 提取选项 ───

export interface ExtractTextOptions {
  ocrEnabled?: boolean | undefined;
  ocrLanguages?: string[] | undefined;
  charDensityThreshold?: number | undefined;
}

// ─── §1.1 extractText 主函数 ───

export async function extractText(
  pdfPath: string,
  options: ExtractTextOptions = {},
): Promise<TextExtractionResult> {
  const ocrEnabled = options.ocrEnabled ?? true;
  const ocrLanguages = options.ocrLanguages ?? ['eng', 'chi_sim'];
  const charDensityThreshold = options.charDensityThreshold ?? 10;

  const mupdf = await getMupdf();

  // §1.2: 打开文档
  const buffer = fs.readFileSync(pdfPath);
  let doc: { loadPage(i: number): unknown; countPages(): number; destroy(): void; needsPassword?(): boolean };
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf') as typeof doc;
  } catch (err) {
    throw new PdfCorruptedError({
      message: `Failed to open PDF: ${(err as Error).message}`,
      context: { pdfPath, corruptionType: 'parse_failure' },
      cause: err as Error,
    });
  }

  if (doc.needsPassword?.()) {
    doc.destroy();
    throw new PdfCorruptedError({
      message: 'PDF is encrypted/password-protected',
      context: { pdfPath, corruptionType: 'encrypted' },
    });
  }

  const pageCount = doc.countPages();
  const pageTexts: string[] = [];
  const pageBoundsArea: number[] = []; // 每页面积（平方英寸）
  const scannedPageIndices: number[] = [];
  const allStyledLines: StyledLine[] = [];

  try {
    // §1.2: 逐页 mupdf.js 提取
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i) as {
        toStructuredText(opts: string): { walk(walker: unknown): void; destroy(): void };
        getBounds(): [number, number, number, number];
        toPixmap(matrix: unknown, colorspace: unknown, alpha?: boolean): { destroy(): void; asPNG(): Buffer };
        destroy(): void;
      };

      try {
        // 获取页面尺寸
        const bounds = page.getBounds();
        const areaPoints = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
        const areaSqIn = areaPoints / (72 * 72);
        pageBoundsArea.push(areaSqIn);

        // 结构化文本提取（保留字体元数据）
        let pageText = '';
        const stext = page.toStructuredText('preserve-whitespace');
        try {
          const lines: string[] = [];
          // 逐行收集字符和字体信息
          const lineFontSizes: number[][] = []; // 每行各字符的字体大小
          const lineFontNames: string[][] = []; // 每行各字符的字体名称

          lineFontSizes.push([]);
          lineFontNames.push([]);

          stext.walk({
            onChar(c: string, _origin: unknown, font: { getName?(): string } | undefined, size: number | undefined) {
              if (lines.length === 0) { lines.push(''); }
              lines[lines.length - 1] += c;
              const idx = lines.length - 1;
              if (!lineFontSizes[idx]) lineFontSizes[idx] = [];
              if (!lineFontNames[idx]) lineFontNames[idx] = [];
              lineFontSizes[idx]!.push(size ?? 0);
              lineFontNames[idx]!.push(
                (typeof font?.getName === 'function' ? font.getName() : '') ?? '',
              );
            },
            endLine() {
              lines.push('');
              lineFontSizes.push([]);
              lineFontNames.push([]);
            },
          });
          pageText = lines.join('\n');

          // 构建 StyledLine 数组
          for (let li = 0; li < lines.length; li++) {
            const text = lines[li]!;
            if (text.trim().length === 0) continue;
            const sizes = lineFontSizes[li] ?? [];
            const names = lineFontNames[li] ?? [];
            // 字体大小取众数
            const fontSize = sizes.length > 0
              ? mode(sizes)
              : 0;
            // Bold 检测：任一字符字体名含 Bold/bold
            const isBold = names.some((n) =>
              /bold/i.test(n),
            );
            allStyledLines.push({ text, fontSize, isBold, pageIndex: i });
          }
        } finally {
          stext.destroy();
        }

        pageTexts.push(pageText);

        // §1.3: 扫描件检测
        const chars = pageText.replace(/\s/g, '').length;
        const density = areaSqIn > 0 ? chars / areaSqIn : 0;

        // §3a 改进：有效词元占比检测（防止不可见乱码文本绕过密度检测）
        // Fix: 增加 chars > 0 守卫，防止除零
        if (density >= charDensityThreshold && chars > 100) {
          const alphaCount = (pageText.match(/[a-zA-Z\u4e00-\u9fff]/g) ?? []).length;
          const alphaRatio = chars > 0 ? alphaCount / chars : 0;
          if (alphaRatio < 0.3) {
            // 虽然字符密度达标，但有效字符占比极低→乱码页
            scannedPageIndices.push(i);
            continue;
          }
        }

        if (density < charDensityThreshold) {
          scannedPageIndices.push(i);
        }
      } finally {
        page.destroy();
      }
    }

    // §1.4: OCR 降级（并发 Worker Pool）
    let ocrConfidences: number[] = [];
    if (ocrEnabled && scannedPageIndices.length > 0) {
      let scheduler: typeof ocrScheduler;
      try {
        scheduler = await getOcrScheduler(ocrLanguages);
      } catch {
        // OCR 引擎初始化失败——降级为 mupdf-only
        scheduler = null;
      }

      if (scheduler) {
        // 先渲染全部扫描页为 PNG（mupdf 操作必须在主线程串行）
        const pngBuffers: Array<{ pageIdx: number; png: Buffer }> = [];
        for (const pageIdx of scannedPageIndices) {
          const page = doc.loadPage(pageIdx) as {
            toPixmap(matrix: unknown, colorspace: unknown, alpha?: boolean): { destroy(): void; asPNG(): Buffer };
            destroy(): void;
          };
          try {
            const scale = 300 / 72;
            const pixmap = page.toPixmap(
              [scale, 0, 0, scale, 0, 0],
              (mupdf as { ColorSpace?: { DeviceRGB?: unknown } }).ColorSpace?.DeviceRGB ?? 'DeviceRGB' as unknown,
            );
            try {
              pngBuffers.push({ pageIdx, png: pixmap.asPNG() });
            } finally {
              pixmap.destroy();
            }
          } finally {
            page.destroy();
          }
        }

        // 并发提交 OCR 任务给 Scheduler
        const ocrResults = await Promise.allSettled(
          pngBuffers.map(async ({ pageIdx, png }) => {
            const result = await scheduler!.addJob('recognize', png);
            return { pageIdx, text: result.data.text, confidence: result.data.confidence };
          }),
        );

        for (const r of ocrResults) {
          if (r.status === 'fulfilled') {
            // Fix: OCR 置信度阈值——低于 60% 的 OCR 结果可能比 mupdf 提取更差
            if (r.value.confidence >= 60) {
              pageTexts[r.value.pageIdx] = r.value.text;
            }
            ocrConfidences.push(r.value.confidence);
          }
          // rejected → 保留 mupdf 结果
        }
      }
    }

    // §1.5: 结果组装
    const fullText = pageTexts.join('\n\n');
    const charCount = fullText.length;

    let method: TextExtractionResult['method'];
    if (scannedPageIndices.length === 0) {
      method = 'mupdf';
    } else if (scannedPageIndices.length === pageCount) {
      method = 'ocr';
    } else {
      method = 'mupdf+ocr';
    }

    const ocrConfidence =
      ocrConfidences.length > 0
        ? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length
        : null;

    return {
      fullText,
      pageCount,
      method,
      pageTexts,
      charCount,
      estimatedTokenCount: estimateTokens(fullText),
      ocrConfidence,
      scannedPageIndices,
      styledLines: allStyledLines,
    };
  } finally {
    // §1.6: 资源释放
    doc.destroy();
  }
}
