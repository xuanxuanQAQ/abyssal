import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as pdfjsLib from 'pdfjs-dist';

import { extractText } from '../src/core/process/extract-text';
import {
  preloadAllPageMetadata,
  preloadRemainingPageMetadata,
  readPageMetadata,
  type PDFDocumentLike,
} from '../src/renderer/views/reader/core/pageMetadataPreloader';
import { DlaProxy } from '../src/core/dla/dla-proxy';
import type { PageAnalysisEvent } from '../src/core/dla/dla-proxy';

interface SmokeSample {
  name: string;
  url: string;
  filePath: string;
}

interface ReaderOpenMetrics {
  fileSizeMb: number;
  bufferReadMs: number;
  bufferLoadMs: number;
  fileUrlLoadMs: number;
  firstPageMetadataMs: number;
  fullMetadataMs: number;
  pageCount: number;
}

const SMOKE_DIR = path.join(os.tmpdir(), 'abyssal-pdf-smoke');
const MODEL_PATH = path.join(process.cwd(), 'assets', 'models', 'doclayout-yolo.onnx');
const DLA_PROCESS_PATH = path.join(process.cwd(), 'dist', 'dla-process', 'main.js');
const execFileAsync = promisify(execFile);

const TEXT_PDF: SmokeSample = {
  name: 'attention-is-all-you-need',
  url: 'https://arxiv.org/pdf/1706.03762.pdf',
  filePath: path.join(SMOKE_DIR, 'attention-is-all-you-need.pdf'),
};

const SCANNED_PDF: SmokeSample = {
  name: 'ocrmypdf-linn',
  url: 'https://github.com/ocrmypdf/OCRmyPDF/raw/main/tests/resources/linn.pdf',
  filePath: path.join(SMOKE_DIR, 'ocrmypdf-linn.pdf'),
};

async function ensureSample(sample: SmokeSample): Promise<string> {
  await fs.promises.mkdir(path.dirname(sample.filePath), { recursive: true });
  if (fs.existsSync(sample.filePath)) {
    return sample.filePath;
  }

  try {
    const response = await fetch(sample.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${sample.name}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(sample.filePath, Buffer.from(arrayBuffer));
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }

    await downloadWithPowerShell(sample.url, sample.filePath);
  }

  return sample.filePath;
}

async function downloadWithPowerShell(url: string, filePath: string): Promise<void> {
  const command = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${filePath}' -UseBasicParsing`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command]);
}

async function measureReaderOpen(pdfPath: string): Promise<ReaderOpenMetrics> {
  const stat = await fs.promises.stat(pdfPath);

  const bufferReadStart = performance.now();
  const buffer = await fs.promises.readFile(pdfPath);
  const bufferReadMs = performance.now() - bufferReadStart;

  const bufferLoadStart = performance.now();
  const bufferTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  });
  const bufferDoc = await bufferTask.promise;
  const bufferLoadMs = performance.now() - bufferLoadStart;
  await bufferDoc.destroy();

  const fileUrlLoadStart = performance.now();
  const fileTask = pdfjsLib.getDocument({
    url: pathToFileURL(pdfPath).href,
    disableWorker: true,
  });
  const fileDoc = await fileTask.promise;
  const fileUrlLoadMs = performance.now() - fileUrlLoadStart;

  const readerDoc = fileDoc as unknown as PDFDocumentLike;
  const firstPageStart = performance.now();
  await readPageMetadata(readerDoc, 1);
  const firstPageMetadataMs = performance.now() - firstPageStart;

  const fullMetadataStart = performance.now();
  await preloadRemainingPageMetadata(readerDoc, fileDoc.numPages, { concurrency: 6, batchSize: 8 });
  const fullMetadataMs = performance.now() - fullMetadataStart;

  await fileDoc.destroy();

  return {
    fileSizeMb: stat.size / (1024 * 1024),
    bufferReadMs,
    bufferLoadMs,
    fileUrlLoadMs,
    firstPageMetadataMs,
    fullMetadataMs,
    pageCount: fileDoc.numPages,
  };
}

async function runOcrSmoke(pdfPath: string): Promise<void> {
  const withoutOcrStart = performance.now();
  const withoutOcr = await extractText(pdfPath, {
    ocrEnabled: false,
    ocrLanguages: ['eng'],
  });
  const withoutOcrMs = performance.now() - withoutOcrStart;

  const withOcrStart = performance.now();
  const withOcr = await extractText(pdfPath, {
    ocrEnabled: true,
    ocrLanguages: ['eng'],
  });
  const withOcrMs = performance.now() - withOcrStart;

  console.log('\n[OCR smoke] scanned PDF');
  console.log(JSON.stringify({
    withoutOcr: {
      durationMs: round(withoutOcrMs),
      method: withoutOcr.method,
      scannedPages: withoutOcr.scannedPageIndices.length,
      charCount: withoutOcr.charCount,
      preview: withoutOcr.fullText.slice(0, 120),
    },
    withOcr: {
      durationMs: round(withOcrMs),
      method: withOcr.method,
      scannedPages: withOcr.scannedPageIndices.length,
      charCount: withOcr.charCount,
      ocrConfidence: withOcr.ocrConfidence,
      preview: withOcr.fullText.slice(0, 120),
    },
  }, null, 2));
}

async function runDlaSmoke(pdfPath: string): Promise<void> {
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`DLA model missing: ${MODEL_PATH}`);
  }
  if (!fs.existsSync(DLA_PROCESS_PATH)) {
    throw new Error(`DLA process build missing: ${DLA_PROCESS_PATH}`);
  }

  const proxy = new DlaProxy({
    dlaProcessPath: DLA_PROCESS_PATH,
    modelPath: MODEL_PATH,
    executionProvider: 'cpu',
  });

  const pageEvents: PageAnalysisEvent[] = [];
  const onPage = (event: PageAnalysisEvent) => {
    pageEvents.push(event);
  };

  const start = performance.now();
  proxy.on('page', onPage);
  try {
    await proxy.start();
    await proxy.detect(pdfPath, [0, 1]);
  } finally {
    proxy.off('page', onPage);
    await proxy.shutdown();
  }
  const elapsedMs = performance.now() - start;

  console.log('\n[DLA smoke] text PDF');
  console.log(JSON.stringify({
    durationMs: round(elapsedMs),
    pageCount: pageEvents.length,
    pages: pageEvents.map((event) => ({
      pageIndex: event.pageIndex,
      blockCount: event.blocks.length,
      inferenceMs: event.inferenceMs,
      blockTypes: Array.from(new Set(event.blocks.map((block) => block.type))).slice(0, 8),
    })),
  }, null, 2));
}

async function main(): Promise<void> {
  const textPdfPath = await ensureSample(TEXT_PDF);
  const scannedPdfPath = await ensureSample(SCANNED_PDF);

  const readerMetrics = await measureReaderOpen(textPdfPath);
  console.log('[Reader smoke] text PDF');
  console.log(JSON.stringify({
    pdf: textPdfPath,
    pageCount: readerMetrics.pageCount,
    fileSizeMb: round(readerMetrics.fileSizeMb),
    bufferReadMs: round(readerMetrics.bufferReadMs),
    bufferLoadMs: round(readerMetrics.bufferLoadMs),
    fileUrlLoadMs: round(readerMetrics.fileUrlLoadMs),
    firstPageMetadataMs: round(readerMetrics.firstPageMetadataMs),
    fullMetadataMs: round(readerMetrics.fullMetadataMs),
  }, null, 2));

  const preloadStart = performance.now();
  const doc = await pdfjsLib.getDocument({
    url: pathToFileURL(textPdfPath).href,
    disableWorker: true,
  }).promise;
  await preloadAllPageMetadata(doc as unknown as PDFDocumentLike, doc.numPages, { concurrency: 6, batchSize: 8 });
  await doc.destroy();
  console.log('\n[Reader smoke] full preload baseline');
  console.log(JSON.stringify({
    durationMs: round(performance.now() - preloadStart),
  }, null, 2));

  await runOcrSmoke(scannedPdfPath);
  await runDlaSmoke(textPdfPath);
}

function round(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error('[smoke] failed', error);
  process.exitCode = 1;
});