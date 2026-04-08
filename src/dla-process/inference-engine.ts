/**
 * DLA Inference Engine — ONNX Runtime session manager.
 *
 * Lazily loads the DocLayout-YOLO ONNX model and runs inference.
 * Designed to run inside a child_process.fork() subprocess.
 */

import type { ContentBlock } from '../core/dla/types';
import { preprocessImage, type RawImage } from './preprocess';
import { postprocessDetections } from './postprocess';

let session: any = null;
let ort: any = null;

/** Load onnxruntime-node lazily (only when first inference is requested) */
async function getOrt(): Promise<any> {
  if (!ort) {
    ort = await import('onnxruntime-node');
  }
  return ort;
}

/**
 * Initialize the ONNX inference session.
 *
 * @param modelPath - Absolute path to the .onnx model file
 * @param executionProvider - 'cpu' or 'dml' (DirectML, Windows GPU)
 */
export async function initSession(
  modelPath: string,
  executionProvider: string = 'cpu',
): Promise<void> {
  if (session) return;

  // eslint-disable-next-line no-console
  console.log(`[DLA-Engine] Loading ONNX model from ${modelPath} (EP: ${executionProvider})`);
  const ortModule = await getOrt();

  const providers: string[] = [];
  if (executionProvider === 'dml') {
    providers.push('dml', 'cpu');
  } else {
    providers.push('cpu');
  }

  const t0 = Date.now();
  session = await ortModule.InferenceSession.create(modelPath, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableMemPattern: true,
  });
  // eslint-disable-next-line no-console
  console.log(`[DLA-Engine] Model loaded in ${Date.now() - t0}ms`);
}

/**
 * Run inference on a single page image.
 *
 * @param image - Raw RGB/RGBA pixel buffer from mupdf rendering
 * @param pageIndex - 0-based page number
 * @param targetSize - Model input size (default 1024)
 * @returns Detected content blocks for this page
 */
export async function detectPage(
  image: RawImage,
  pageIndex: number,
  targetSize: number = 1024,
): Promise<{ blocks: ContentBlock[]; inferenceMs: number }> {
  if (!session) {
    throw new Error('DLA session not initialized — call initSession() first');
  }

  const ortModule = await getOrt();

  // Preprocess: resize + letterbox + normalize to NCHW tensor
  const { tensor, letterbox } = preprocessImage(image, targetSize);

  // Create ONNX tensor [1, 3, targetSize, targetSize]
  const inputTensor = new ortModule.Tensor('float32', tensor, [1, 3, targetSize, targetSize]);

  // Run inference
  const startMs = Date.now();
  let results: any;
  try {
    results = await session.run({ images: inputTensor });
  } catch (err) {
    throw new Error(`ONNX inference failed for page ${pageIndex}: ${(err as Error).message}`, { cause: err });
  }
  const inferenceMs = Date.now() - startMs;

  // Get output tensor — shape [1, N, 6]
  const outputNames = Object.keys(results);
  const outputTensor = results[outputNames[0]!];
  const outputData = outputTensor.data as Float32Array;
  const outputDims = outputTensor.dims as number[];

  // dims = [1, N, 6] or [1, 6, N] → determine numDetections from dims
  const numDetections = outputDims[1] === 6
    ? (outputDims[2] ?? outputData.length / 6)
    : (outputDims[1] ?? outputData.length / 6);

  // Postprocess: decode, filter, reverse letterbox → ContentBlock[]
  const blocks = postprocessDetections(
    outputData,
    numDetections,
    letterbox,
    pageIndex,
    image.width,
    image.height,
    {},
    outputDims,
  );

  return { blocks, inferenceMs };
}

/** Release ONNX session resources */
export async function destroySession(): Promise<void> {
  if (session) {
    // eslint-disable-next-line no-console
    console.log('[DLA-Engine] Releasing ONNX session');
    session.release?.();
    session = null;
  }
}
