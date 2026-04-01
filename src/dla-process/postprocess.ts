/**
 * DLA YOLO postprocessing — decode raw model output to ContentBlock[].
 *
 * DocLayout-YOLO (YOLOv10 variant) output format:
 * Tensor shape [1, N, 6] where each detection is [x1, y1, x2, y2, score, classId].
 * YOLOv10 uses NMS-free detection — no additional NMS step needed.
 */

import type { ContentBlock, ContentBlockType, NormalizedBBox } from '../core/dla/types';
import type { LetterboxParams } from './preprocess';

/** DocStructBench 10-class label map (matches DocLayout-YOLO training) */
const CLASS_LABELS: ContentBlockType[] = [
  'title',
  'text',
  'abandoned',
  'figure',
  'figure_caption',
  'table',
  'table_caption',
  'table_footnote',
  'formula',
  'formula_caption',
];

export interface PostprocessOptions {
  /** Minimum confidence threshold (default: 0.25) */
  confidenceThreshold?: number;
  /** IoU threshold for NMS — only used if model outputs require NMS (default: 0.45) */
  iouThreshold?: number;
}

/**
 * Decode YOLO output tensor to content blocks.
 *
 * @param output - Raw Float32Array from ONNX inference, shape [1, N, 6]
 * @param numDetections - Number of detection rows (N)
 * @param letterbox - Letterbox params from preprocessing
 * @param pageIndex - 0-based page index
 * @param imageWidth - Original image width before preprocessing
 * @param imageHeight - Original image height before preprocessing
 */
/**
 * Decode YOLO output tensor to content blocks.
 *
 * Handles two common YOLO output layouts:
 * - Row-major `[1, N, 6]`: each row is [x1, y1, x2, y2, score, classId]
 * - Transposed `[1, 6, N]`: 6 attribute planes of length N (some YOLOv8/v10 exports)
 *
 * Detection logic: compare dims[1] vs dims[2] — the "6" side is the attribute axis.
 */
export function postprocessDetections(
  output: Float32Array,
  numDetections: number,
  letterbox: LetterboxParams,
  pageIndex: number,
  imageWidth: number,
  imageHeight: number,
  options: PostprocessOptions = {},
  outputDims?: number[],
): ContentBlock[] {
  const confThresh = options.confidenceThreshold ?? 0.25;
  const blocks: ContentBlock[] = [];

  // Detect transposed layout: [1, 6, N] where dims[1]=6 and dims[2]=N
  const isTransposed = outputDims != null
    && outputDims.length === 3
    && outputDims[1] === 6
    && outputDims[2]! > 6;
  const N = isTransposed ? outputDims![2]! : numDetections;

  for (let i = 0; i < N; i++) {
    let x1: number, y1: number, x2: number, y2: number, score: number, classId: number;

    if (isTransposed) {
      // [1, 6, N] — attribute planes: output[attr * N + i]
      x1      = output[0 * N + i]!;
      y1      = output[1 * N + i]!;
      x2      = output[2 * N + i]!;
      y2      = output[3 * N + i]!;
      score   = output[4 * N + i]!;
      classId = Math.round(output[5 * N + i]!);
    } else {
      // [1, N, 6] — row-major
      const offset = i * 6;
      x1      = output[offset]!;
      y1      = output[offset + 1]!;
      x2      = output[offset + 2]!;
      y2      = output[offset + 3]!;
      score   = output[offset + 4]!;
      classId = Math.round(output[offset + 5]!);
    }

    if (score < confThresh) continue;
    if (classId < 0 || classId >= CLASS_LABELS.length) continue;

    // Reverse letterbox: model coords → original image coords
    const bbox = reverseLetterbox(x1, y1, x2, y2, letterbox, imageWidth, imageHeight);
    if (!bbox) continue;

    blocks.push({
      type: CLASS_LABELS[classId]!,
      bbox,
      confidence: score,
      pageIndex,
    });
  }

  // Sort by vertical position (top to bottom), then left to right
  blocks.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

  return blocks;
}

/**
 * Convert model-space coordinates back to normalized [0,1] coordinates
 * relative to the original image.
 */
function reverseLetterbox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lb: LetterboxParams,
  origW: number,
  origH: number,
): NormalizedBBox | null {
  // Remove padding offset
  const ux1 = x1 - lb.padX;
  const uy1 = y1 - lb.padY;
  const ux2 = x2 - lb.padX;
  const uy2 = y2 - lb.padY;

  // Reverse scale to original image coordinates
  const ox1 = ux1 / lb.scale;
  const oy1 = uy1 / lb.scale;
  const ox2 = ux2 / lb.scale;
  const oy2 = uy2 / lb.scale;

  // Clamp to image bounds
  const cx1 = Math.max(0, Math.min(ox1, origW));
  const cy1 = Math.max(0, Math.min(oy1, origH));
  const cx2 = Math.max(0, Math.min(ox2, origW));
  const cy2 = Math.max(0, Math.min(oy2, origH));

  const w = cx2 - cx1;
  const h = cy2 - cy1;

  // Skip tiny detections
  if (w < 2 || h < 2) return null;

  // Normalize to [0, 1]
  return {
    x: cx1 / origW,
    y: cy1 / origH,
    w: w / origW,
    h: h / origH,
  };
}
