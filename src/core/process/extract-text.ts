// ═══ 混合文本提取引擎 ═══
// §1: mupdf.js 结构化提取 → 扫描件检测 → OCR 降级
//
// 改进：保留字体元数据（大小/名称）供 extractSections 用于节标题识别，
// 避免纯正则误将有序列表误判为节标题。

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TextExtractionResult, PdfEmbeddedMetadata, FirstPageMetadata, StyledLine } from './types';
import type { PageCharData, CharWithPosition, OcrLine, OcrWord, PageOcrLines, NormalizedBBox } from '../dla/types';
import { PdfCorruptedError, ProcessError, OcrFailedError } from '../types/errors';
import { countTokens, estimateTokens } from '../infra/token-counter';
import { deriveExtractionMethod } from './extraction-method';

// ─── mupdf.js 懒加载 ───

let mupdfModule: typeof import('mupdf') | null = null;
let mupdfInitPromise: Promise<typeof import('mupdf')> | null = null;

const MUPDF_IGNORABLE_WARNINGS = [
  /^warning: line feed missing after stream begin marker/i,
];

function createMupdfModuleOptions(): { printErr: (message: string) => void } {
  return {
    printErr(message: string) {
      const text = String(message ?? '').trim();
      if (MUPDF_IGNORABLE_WARNINGS.some((pattern) => pattern.test(text))) {
        return;
      }
      console.warn(text);
    },
  };
}

async function getMupdf(): Promise<typeof import('mupdf')> {
  if (mupdfModule) return mupdfModule;
  if (mupdfInitPromise) return mupdfInitPromise;

  mupdfInitPromise = (async () => {
    const previousOptions = (globalThis as typeof globalThis & { $libmupdf_wasm_Module?: unknown }).$libmupdf_wasm_Module;
    (globalThis as typeof globalThis & { $libmupdf_wasm_Module?: unknown }).$libmupdf_wasm_Module = createMupdfModuleOptions();
    try {
      mupdfModule = await import('mupdf');
    } catch {
      try {
        const fallbackSpecifier = 'mupdf/dist/mupdf.js';
        mupdfModule = await import(/* @vite-ignore */ fallbackSpecifier);
      } catch (err) {
        throw new ProcessError({
          message: `Failed to load mupdf.js: ${(err as Error).message}`,
          cause: err as Error,
        });
      }
    } finally {
      if (previousOptions === undefined) {
        delete (globalThis as typeof globalThis & { $libmupdf_wasm_Module?: unknown }).$libmupdf_wasm_Module;
      } else {
        (globalThis as typeof globalThis & { $libmupdf_wasm_Module?: unknown }).$libmupdf_wasm_Module = previousOptions;
      }
      mupdfInitPromise = null;
    }
    return mupdfModule!;
  })();

  return mupdfInitPromise;
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
  addJob(method: string, ...args: unknown[]): Promise<{ data: { text: string; confidence: number; blocks: unknown[] | null } }>;
  terminate(): Promise<void>;
} | null = null;

/** 序列化初始化锁——防止并发 extractText 创建重复 Worker Pool */
let ocrInitPromise: Promise<typeof ocrScheduler> | null = null;

const OCR_POOL_SIZE = Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) || 4);

/** Hard page limit to prevent OOM on very large documents */
const MAX_PAGES = 2000;

/** Per-job OCR timeout (ms) — prevents a single hung page from blocking the pool */
const OCR_JOB_TIMEOUT_MS = 60_000;

/** Max OCR jobs allowed in flight at once — bounds PNG memory and scheduler pressure */
const MAX_PENDING_OCR_JOBS = Math.max(2, OCR_POOL_SIZE * 2);

function findExistingPath(
  candidates: string[],
  pathExists: (target: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveOcrRuntimePaths(
  baseDir: string = __dirname,
  resourcesPath: string | undefined = process.resourcesPath,
  pathExists: (target: string) => boolean = fs.existsSync,
): { workerPath: string; langDir: string | null } {
  const workerCandidates = [
    path.resolve(baseDir, 'tesseract-worker.cjs'),
    path.resolve(baseDir, '..', 'core', 'process', 'tesseract-worker.cjs'),
  ];
  const langCandidates = [
    path.resolve(baseDir, '..', '..', 'assets', 'tesseract'),
    path.resolve(baseDir, '..', '..', '..', 'assets', 'tesseract'),
    ...(resourcesPath ? [path.join(resourcesPath, 'tesseract')] : []),
  ];

  return {
    workerPath: findExistingPath(workerCandidates, pathExists) ?? workerCandidates[workerCandidates.length - 1]!,
    langDir: findExistingPath(langCandidates, pathExists),
  };
}

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
      const { workerPath, langDir } = resolveOcrRuntimePaths();

      // Use bundled traineddata from assets/tesseract/ to avoid CDN download.
      // jsdelivr is often blocked/slow in China, AND tesseract.js detects Electron
      // as env='electron' (not 'node'), which makes it try to fetch() local file
      // paths as URLs — crashing on Windows.
      //
      // Fix: set `cachePath` to our assets dir. The worker checks the cache
      // (plain fs.readFile) BEFORE any URL/fetch logic, so it loads directly
      // from disk without hitting the broken env detection code path.
      const hasLocalData = langDir !== null && languages.every((l) =>
        fs.existsSync(path.join(langDir, `${l}.traineddata`)),
      );
      const workerOpts = hasLocalData
        ? {
            workerPath,
            langPath: langDir,
            cachePath: langDir,
            cacheMethod: 'readOnly',
            gzip: false,
          }
        : { workerPath };

      // Worker Pool (track created workers for cleanup on failure)
      for (let i = 0; i < OCR_POOL_SIZE; i++) {
        const worker = await Tesseract.createWorker(languages.join('+'), undefined, workerOpts);
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
  /** Maximum pages to process. Documents exceeding this throw ProcessError. Default: 2000 */
  maxPages?: number | undefined;
  /** Per-OCR-job timeout in ms. Default: 60000 */
  ocrJobTimeoutMs?: number | undefined;
}

// ─── §1.1 extractText 主函数 ───

export async function extractText(
  pdfPath: string,
  options: ExtractTextOptions = {},
): Promise<TextExtractionResult> {
  const ocrEnabled = options.ocrEnabled ?? true;
  const ocrLanguages = options.ocrLanguages ?? ['eng', 'chi_sim'];
  const charDensityThreshold = options.charDensityThreshold ?? 10;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const ocrJobTimeout = options.ocrJobTimeoutMs ?? OCR_JOB_TIMEOUT_MS;

  const mupdf = await getMupdf();

  // §1.2: 打开文档（Fix #10: 异步读取避免阻塞主线程）
  const buffer = await fs.promises.readFile(pdfPath);
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

  // Fix #4: Hard page limit to prevent OOM
  if (pageCount > maxPages) {
    doc.destroy();
    throw new ProcessError({
      message: `Document has ${pageCount} pages, exceeding the limit of ${maxPages}. Split the document or increase the limit.`,
    });
  }

  // Fix #11: 超大文档内存警告
  if (pageCount > 500) {
    console.warn(
      `[extract-text] Large document: ${pageCount} pages. Processing may use significant memory.`,
    );
  }

  const pageTexts: string[] = [];
  const pageBoundsArea: number[] = []; // 每页面积（平方英寸）
  const pageBoundsRaw: Array<[number, number, number, number]> = []; // 原始页面边界 [x0,y0,x1,y1]
  const scannedPageIndices: number[] = [];
  const allStyledLines: StyledLine[] = [];
  const allPageCharData: PageCharData[] = [];

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
        pageBoundsRaw.push(bounds);

        // 结构化文本提取（保留字体元数据 + 字符坐标）
        let pageText = '';
        const stext = page.toStructuredText('preserve-whitespace');
        const pageBounds = bounds; // [x0, y0, x1, y1] in PDF points
        const pageW = pageBounds[2] - pageBounds[0];
        const pageH = pageBounds[3] - pageBounds[1];
        try {
          const lines: string[] = [];
          // 逐行收集字符和字体信息
          const lineFontSizes: number[][] = []; // 每行各字符的字体大小
          const lineFontNames: string[][] = []; // 每行各字符的字体名称
          const pageChars: CharWithPosition[] = [];

          lineFontSizes.push([]);
          lineFontNames.push([]);

          stext.walk({
            onChar(c: string, origin: unknown, font: { getName?(): string } | undefined, size: number | undefined) {
              if (lines.length === 0) { lines.push(''); }
              lines[lines.length - 1] += c;
              const idx = lines.length - 1;
              if (!lineFontSizes[idx]) lineFontSizes[idx] = [];
              if (!lineFontNames[idx]) lineFontNames[idx] = [];
              const fs = size ?? 0;
              const fn = (typeof font?.getName === 'function' ? font.getName() : '') ?? '';
              lineFontSizes[idx]!.push(fs);
              lineFontNames[idx]!.push(fn);

              // 捕获字符坐标（归一化到 [0,1]）
              const o = origin as [number, number] | undefined;
              if (o && pageW > 0 && pageH > 0) {
                pageChars.push({
                  char: c,
                  x: (o[0] - pageBounds[0]) / pageW,
                  y: (o[1] - pageBounds[1]) / pageH,
                  fontSize: fs,
                  isBold: /bold/i.test(fn),
                  pageIndex: i,
                });
              }
            },
            endLine() {
              lines.push('');
              lineFontSizes.push([]);
              lineFontNames.push([]);
            },
          });

          allPageCharData.push({
            pageIndex: i,
            chars: pageChars,
            pageWidth: pageW,
            pageHeight: pageH,
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
          // Fix #12: 扩展有效字符范围，包含希腊字母、数学运算符、字母符号、Latin Extended
          const alphaCount = (pageText.match(/[a-zA-Z\u4e00-\u9fff\u0370-\u03FF\u2200-\u22FF\u2100-\u214F\u00C0-\u00FF]/g) ?? []).length;
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
    const ocrAppliedPages = new Set<number>();
    const ocrPageLinesMap = new Map<number, OcrLine[]>();
    if (ocrEnabled && scannedPageIndices.length > 0) {
      let scheduler: typeof ocrScheduler;
      try {
        scheduler = await getOcrScheduler(ocrLanguages);
      } catch {
        // OCR 引擎初始化失败——降级为 mupdf-only
        scheduler = null;
      }

      if (scheduler) {
        const processOcrResult = (
          result:
            | PromiseSettledResult<{ pageIdx: number; text: string; confidence: number; blocks: unknown[] | null }>
            | { status: 'fulfilled'; value: { pageIdx: number; text: string; confidence: number; blocks: unknown[] | null } },
        ) => {
          if (result.status !== 'fulfilled') {
            return;
          }

          if (result.value.confidence >= 60) {
            pageTexts[result.value.pageIdx] = result.value.text;
            ocrAppliedPages.add(result.value.pageIdx);

            // Extract line-level bbox from Tesseract blocks hierarchy
            const pageIdx = result.value.pageIdx;
            const blocks = result.value.blocks;
            if (blocks && Array.isArray(blocks)) {
              const pageArea = pageBoundsArea[pageIdx] ?? 0;
              // Image dimensions at 300 DPI
              const imgScale = 300 / 72;
              const bounds = pageBoundsRaw[pageIdx];
              const imgW = bounds ? (bounds[2] - bounds[0]) * imgScale : 1;
              const imgH = bounds ? (bounds[3] - bounds[1]) * imgScale : 1;
              const lines: OcrLine[] = [];
              let lineIndex = 0;

              for (const block of blocks as Array<{ paragraphs?: Array<{ lines?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; words?: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> }> }> }>) {
                for (const paragraph of block.paragraphs ?? []) {
                  for (const line of paragraph.lines ?? []) {
                    const text = line.text?.trim();
                    const bbox = line.bbox;
                    if (!text || !bbox) continue;

                    const normalizedBBox: NormalizedBBox = {
                      x: bbox.x0 / imgW,
                      y: bbox.y0 / imgH,
                      w: (bbox.x1 - bbox.x0) / imgW,
                      h: (bbox.y1 - bbox.y0) / imgH,
                    };

                    // Extract word-level bboxes for precise alignment
                    const words: OcrWord[] = [];
                    if (line.words && Array.isArray(line.words)) {
                      for (const word of line.words) {
                        const wText = word.text?.trim();
                        const wBbox = word.bbox;
                        if (!wText || !wBbox) continue;
                        words.push({
                          text: wText,
                          bbox: {
                            x: wBbox.x0 / imgW,
                            y: wBbox.y0 / imgH,
                            w: (wBbox.x1 - wBbox.x0) / imgW,
                            h: (wBbox.y1 - wBbox.y0) / imgH,
                          },
                          confidence: word.confidence ?? 0,
                        });
                      }
                    }

                    lines.push({
                      text,
                      bbox: normalizedBBox,
                      confidence: line.confidence ?? 0,
                      pageIndex: pageIdx,
                      lineIndex: lineIndex++,
                      ...(words.length > 0 ? { words } : {}),
                    });
                  }
                }
              }

              if (lines.length > 0) {
                ocrPageLinesMap.set(pageIdx, lines);
              }
            }
          }
          ocrConfidences.push(result.value.confidence);
        };

        const inFlight: Array<Promise<{ pageIdx: number; text: string; confidence: number; blocks: unknown[] | null }>> = [];

        for (const pageIdx of scannedPageIndices) {
          const page = doc.loadPage(pageIdx) as {
            toPixmap(matrix: unknown, colorspace: unknown, alpha?: boolean): { destroy(): void; asPNG(): Buffer };
            destroy(): void;
          };

          let png: Buffer;
          try {
            const scale = 300 / 72;
            const pixmap = page.toPixmap(
              [scale, 0, 0, scale, 0, 0],
              (mupdf as { ColorSpace?: { DeviceRGB?: unknown } }).ColorSpace?.DeviceRGB ?? 'DeviceRGB' as unknown,
            );
            try {
              png = pixmap.asPNG();
            } finally {
              pixmap.destroy();
            }
          } finally {
            page.destroy();
          }

          const job = Promise.race([
            scheduler.addJob('recognize', png, {}, { blocks: true }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`OCR timeout for page ${pageIdx}`)), ocrJobTimeout),
            ),
          ]).then((result) => ({ pageIdx, text: result.data.text, confidence: result.data.confidence, blocks: result.data.blocks }));

          inFlight.push(job);

          if (inFlight.length >= MAX_PENDING_OCR_JOBS) {
            const settled = await Promise.allSettled(inFlight.splice(0, inFlight.length));
            for (const result of settled) {
              processOcrResult(result);
            }
          }
        }

        if (inFlight.length > 0) {
          const settled = await Promise.allSettled(inFlight);
          for (const result of settled) {
            processOcrResult(result);
          }
        }
      }
    }

    // §1.5a: PDF metadata dict 提取（零成本）
    const pdfMetadata: PdfEmbeddedMetadata = { title: null, author: null, subject: null, keywords: null, creator: null, producer: null, creationDate: null };
    try {
      const docAny = doc as unknown as { getMetadata?(key: string): string };
      if (typeof docAny.getMetadata === 'function') {
        const get = (key: string): string | null => {
          try {
            const v = docAny.getMetadata!(key);
            return (v && typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;
          } catch { return null; }
        };
        pdfMetadata.title = get('info:Title');
        pdfMetadata.author = get('info:Author');
        pdfMetadata.subject = get('info:Subject');
        pdfMetadata.keywords = get('info:Keywords');
        pdfMetadata.creator = get('info:Creator');
        pdfMetadata.producer = get('info:Producer');
        pdfMetadata.creationDate = get('info:CreationDate');
      }
    } catch { /* non-fatal */ }

    // §1.5b: 首页启发式标题/作者提取
    const firstPage: FirstPageMetadata = { titleCandidate: null, authorCandidates: [], firstPageText: '' };
    {
      // 收集首页 styledLines
      const page0Lines = allStyledLines.filter((l) => l.pageIndex === 0);
      firstPage.firstPageText = (pageTexts[0] ?? '').slice(0, 2000);

      if (page0Lines.length > 0) {
        // 计算全文档基线字号（众数）
        const allSizes = allStyledLines.map((l) => l.fontSize).filter((s) => s > 0);
        const baselineSize = allSizes.length > 0 ? mode(allSizes) : 10;

        // 标题候选：首页中字号 > 基线 × 1.3 的最大字号行
        const titleThreshold = baselineSize * 1.3;
        const largeFontLines = page0Lines
          .filter((l) => l.fontSize > titleThreshold && l.text.trim().length > 3)
          .sort((a, b) => b.fontSize - a.fontSize);

        if (largeFontLines.length > 0) {
          // 合并连续的最大字号行作为标题（多行标题）
          const maxSize = largeFontLines[0]!.fontSize;
          const titleLines = largeFontLines
            .filter((l) => Math.abs(l.fontSize - maxSize) < 0.5)
            .map((l) => l.text.trim());
          firstPage.titleCandidate = titleLines.join(' ').replace(/\s+/g, ' ');
        }

        // 作者候选：标题下方、字号比标题小但比正文大（或 bold）的行
        // 取标题之后到 Abstract/Introduction 之前的行
        if (firstPage.titleCandidate) {
          const titleIdx = page0Lines.findIndex(
            (l) => l.text.trim() === largeFontLines[0]?.text.trim(),
          );
          if (titleIdx >= 0) {
            const authorThreshold = baselineSize * 0.95;
            for (let j = titleIdx + 1; j < page0Lines.length; j++) {
              const line = page0Lines[j]!;
              const trimmed = line.text.trim();
              // 遇到 Abstract/关键字/Introduction 等标记 → 停止
              if (/^(abstract|摘\s*要|introduction|keywords|关键词)/i.test(trimmed)) break;
              // 空行跳过
              if (trimmed.length === 0) continue;
              // 太长的行可能是正文
              if (trimmed.length > 200) break;
              // 字号略大于正文或 bold → 可能是作者
              if (line.fontSize > authorThreshold || line.isBold) {
                firstPage.authorCandidates.push(trimmed);
              }
              // 收集到足够作者行后停止
              if (firstPage.authorCandidates.length >= 10) break;
            }
          }
        }
      }
    }

    // §1.5: 结果组装
    const fullText = pageTexts.join('\n\n');
    const charCount = fullText.length;

    const method = deriveExtractionMethod(pageCount, scannedPageIndices.length, ocrAppliedPages.size);

    const ocrConfidence =
      ocrConfidences.length > 0
        ? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length
        : null;

    // Build ocrPageLines from collected map
    const ocrPageLines: import('../dla/types').PageOcrLines[] = [];
    for (const [pageIdx, lines] of ocrPageLinesMap) {
      ocrPageLines.push({ pageIndex: pageIdx, lines });
    }
    ocrPageLines.sort((a, b) => a.pageIndex - b.pageIndex);

    const result: TextExtractionResult = {
      fullText,
      pageCount,
      method,
      pageTexts,
      charCount,
      estimatedTokenCount: estimateTokens(fullText),
      ocrConfidence,
      scannedPageIndices,
      styledLines: allStyledLines,
      pdfMetadata,
      firstPage,
      pageCharData: allPageCharData,
    };

    if (ocrPageLines.length > 0) {
      result.ocrPageLines = ocrPageLines;
    }

    return result;
  } finally {
    // §1.6: 资源释放
    doc.destroy();
  }
}
