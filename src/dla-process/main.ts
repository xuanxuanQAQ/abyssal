/**
 * DLA 子进程入口
 *
 * 由 Electron 主进程通过 child_process.fork() 启动。
 * 接收页面图片渲染请求，运行 ONNX 推理，返回 ContentBlock[]。
 *
 * 设计与 db-process/main.ts 同构：
 * - lifecycle 消息管理初始化/关闭
 * - detect 消息触发推理
 * - 逐页返回结果 + 进度
 */

import * as fs from 'node:fs';
import { initSession, detectPage, destroySession } from './inference-engine';
import type { RawImage } from './preprocess';
import type {
  DlaProcessMessage,
  DlaDetectRequest,
  DlaDetectResult,
  DlaDetectProgress,
  DlaDetectError,
  DlaLifecycleResponse,
} from '../core/dla/types';
import { isDlaLifecycleMessage, isDlaDetectRequest } from '../core/dla/types';

let initialized = false;

function log(msg: string, data?: Record<string, unknown>): void {
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[DLA-Process] ${msg}${payload}`);
}

function logWarn(msg: string, data?: Record<string, unknown>): void {
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[DLA-Process] ${msg}${payload}`);
}

// ─── Message Dispatcher ───

process.on('message', async (msg: DlaProcessMessage) => {
  if (isDlaLifecycleMessage(msg)) {
    await handleLifecycle(msg);
  } else if (isDlaDetectRequest(msg)) {
    await handleDetect(msg);
  }
});

// ─── Lifecycle ───

async function handleLifecycle(msg: DlaProcessMessage & { type: 'lifecycle' }): Promise<void> {
  const respond = (success: boolean, error?: string) => {
    const resp: DlaLifecycleResponse = {
      type: 'lifecycle',
      action: msg.action,
      success,
      ...(error ? { error } : {}),
    };
    process.send?.(resp);
  };

  if (msg.action === 'init' && msg.payload) {
    log('Initializing ONNX session', { modelPath: msg.payload.modelPath, ep: msg.payload.executionProvider });
    const t0 = Date.now();
    try {
      await initSession(msg.payload.modelPath, msg.payload.executionProvider);
      initialized = true;
      log(`ONNX session ready in ${Date.now() - t0}ms`);
      respond(true);
    } catch (err) {
      logWarn('ONNX session init failed', { error: (err as Error).message });
      respond(false, (err as Error).message);
    }
  } else if (msg.action === 'shutdown') {
    log('Shutting down');
    closeCachedDocument();
    await destroySession();
    initialized = false;
    respond(true);
    // Allow pending I/O to flush before exit
    setTimeout(() => process.exit(0), 100);
  }
}

// ─── PDF Document Cache ───
// Avoid re-opening the same PDF file for each batch request.

let cachedDocPath: string | null = null;
let cachedDoc: any = null;

async function getOrOpenDocument(mupdf: any, pdfPath: string): Promise<any> {
  if (cachedDoc && cachedDocPath === pdfPath) {
    return cachedDoc;
  }
  closeCachedDocument();

  const pdfBuffer = await fs.promises.readFile(pdfPath);
  cachedDoc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  cachedDocPath = pdfPath;
  log('Opened PDF', { path: pdfPath });
  return cachedDoc;
}

function closeCachedDocument(): void {
  if (cachedDoc) {
    cachedDoc.destroy?.();
    cachedDoc = null;
    cachedDocPath = null;
  }
}

// ─── Detection ───

async function handleDetect(msg: DlaDetectRequest): Promise<void> {
  if (!initialized) {
    sendError(msg.id, 'DLA session not initialized');
    return;
  }

  const { id, pdfPath, pageIndices, targetSize } = msg;
  log(`Detect request ${id}: ${pageIndices.length} pages`, { pages: pageIndices });

  let mupdf: any;
  try {
    mupdf = await loadMupdf();
  } catch (err) {
    sendError(id, `Failed to load mupdf: ${(err as Error).message}`);
    return;
  }

  let doc: any;
  try {
    doc = await getOrOpenDocument(mupdf, pdfPath);
  } catch (err) {
    sendError(id, `Failed to open PDF: ${(err as Error).message}`);
    return;
  }

  const total = pageIndices.length;

  for (let i = 0; i < total; i++) {
    const pageIdx = pageIndices[i]!;
    const pageT0 = Date.now();

    try {
      const image = renderPageToImage(mupdf, doc, pageIdx, targetSize ?? 1024);
      const renderMs = Date.now() - pageT0;
      const { blocks, inferenceMs } = await detectPage(image, pageIdx, targetSize);

      log(`Page ${pageIdx}: ${blocks.length} blocks (render=${renderMs}ms, infer=${inferenceMs}ms)`);

      const result: DlaDetectResult = {
        id,
        type: 'detect:result',
        pageIndex: pageIdx,
        blocks,
        inferenceMs,
      };
      process.send?.(result);
    } catch (err) {
      logWarn(`Page ${pageIdx} failed`, { error: (err as Error).message });
      const errResp: DlaDetectError = {
        id,
        type: 'detect:error',
        message: (err as Error).message,
        pageIndex: pageIdx,
      };
      process.send?.(errResp);
    }

    // Send progress
    const progress: DlaDetectProgress = {
      id,
      type: 'detect:progress',
      completed: i + 1,
      total,
    };
    process.send?.(progress);
  }
}

// ─── Page Rendering (mupdf) ───

let mupdfModule: any = null;

type MupdfImporters = {
  primary: () => Promise<any>;
  fallback: (specifier: string) => Promise<any>;
};

const defaultMupdfImporters: MupdfImporters = {
  primary: async () => import('mupdf'),
  fallback: async (specifier: string) => import(/* @vite-ignore */ specifier),
};

let mupdfImporters: MupdfImporters = defaultMupdfImporters;

async function loadMupdf(): Promise<any> {
  if (!mupdfModule) {
    try {
      mupdfModule = await mupdfImporters.primary();
    } catch {
      const fallbackSpecifier = 'mupdf/dist/mupdf.js';
      mupdfModule = await mupdfImporters.fallback(fallbackSpecifier);
    }
  }
  return mupdfModule;
}

function renderPageToImage(
  mupdf: any,
  doc: any,
  pageIndex: number,
  targetSize: number,
): RawImage {
  const page = doc.loadPage(pageIndex);
  let pixmap: any = null;
  try {
    const bounds = page.getBounds();
    // getBounds() returns [x0, y0, x1, y1] — account for non-zero origin
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];

    // Compute scale to make longest edge = targetSize
    const longEdge = Math.max(pageW, pageH);
    const scale = targetSize / longEdge;

    const matrix = mupdf.Matrix.scale(scale, scale);
    pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);

    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const samples = pixmap.getPixels();

    // mupdf pixmap.getPixels() returns RGB Uint8Array
    const data = Buffer.from(samples);

    return { data, width, height, channels: 3 };
  } finally {
    try { pixmap?.destroy?.(); } catch { /* ignore cleanup failure */ }
    try { page.destroy?.(); } catch { /* ignore cleanup failure */ }
  }
}

// ─── Helpers ───

function sendError(id: string, message: string): void {
  logWarn(`Error: ${message}`, { id });
  const err: DlaDetectError = { id, type: 'detect:error', message };
  process.send?.(err);
}

// ─── Graceful Shutdown ───

process.on('disconnect', async () => {
  log('Parent disconnected, shutting down');
  closeCachedDocument();
  await destroySession();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down');
  closeCachedDocument();
  await destroySession();
  process.exit(0);
});

export const __testing__ = {
  setMupdfImporters(overrides: Partial<MupdfImporters>): void {
    mupdfImporters = {
      ...mupdfImporters,
      ...overrides,
    };
    mupdfModule = null;
  },
  resetMupdfImporters(): void {
    mupdfImporters = defaultMupdfImporters;
    mupdfModule = null;
  },
};
