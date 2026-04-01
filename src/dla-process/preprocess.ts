/**
 * DLA image preprocessing — resize, letterbox pad, normalize to NCHW tensor.
 *
 * DocLayout-YOLO expects 1024×1024 RGB input with letterbox padding.
 * We perform all transforms on raw pixel buffers (no Canvas dependency).
 */

/** Raw RGBA pixel buffer from mupdf */
export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

export interface PreprocessResult {
  /** Float32Array in NCHW layout [1, 3, 1024, 1024] */
  tensor: Float32Array;
  /** Letterbox parameters for coordinate de-mapping */
  letterbox: LetterboxParams;
}

export interface LetterboxParams {
  scale: number;
  padX: number;
  padY: number;
  newWidth: number;
  newHeight: number;
  targetSize: number;
}

/**
 * Preprocess an image for YOLO inference.
 *
 * Steps:
 * 1. Compute scale to fit longest edge into targetSize
 * 2. Bilinear resize
 * 3. Letterbox pad to targetSize × targetSize (gray fill = 114/255)
 * 4. Normalize to [0, 1] in NCHW Float32Array
 */
export function preprocessImage(image: RawImage, targetSize: number = 1024): PreprocessResult {
  const { width: srcW, height: srcH, data: srcData, channels } = image;

  // Step 1: compute resize scale (fit longest edge)
  const scale = targetSize / Math.max(srcW, srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);

  // Step 2: bilinear resize
  const resized = bilinearResize(srcData, srcW, srcH, channels, newW, newH);

  // Step 3: letterbox padding
  const padX = Math.floor((targetSize - newW) / 2);
  const padY = Math.floor((targetSize - newH) / 2);

  // Step 4: build NCHW tensor with padding value = 114/255
  const padValue = 114 / 255;
  const tensorSize = 3 * targetSize * targetSize;
  const tensor = new Float32Array(tensorSize);
  tensor.fill(padValue);

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcIdx = (y * newW + x) * 3;
      const dstX = x + padX;
      const dstY = y + padY;

      // NCHW: channel × height × width
      const planeSize = targetSize * targetSize;
      const pixelOffset = dstY * targetSize + dstX;

      tensor[0 * planeSize + pixelOffset] = resized[srcIdx]! / 255;     // R
      tensor[1 * planeSize + pixelOffset] = resized[srcIdx + 1]! / 255; // G
      tensor[2 * planeSize + pixelOffset] = resized[srcIdx + 2]! / 255; // B
    }
  }

  return {
    tensor,
    letterbox: { scale, padX, padY, newWidth: newW, newHeight: newH, targetSize },
  };
}

/**
 * Bilinear interpolation resize (RGB output).
 * Input can be 3-channel (RGB) or 4-channel (RGBA) — alpha is dropped.
 */
function bilinearResize(
  src: Buffer,
  srcW: number,
  srcH: number,
  channels: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 3);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const srcY = dy * yRatio;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = srcY - y0;

    for (let dx = 0; dx < dstW; dx++) {
      const srcX = dx * xRatio;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = srcX - x0;

      const i00 = (y0 * srcW + x0) * channels;
      const i10 = (y0 * srcW + x1) * channels;
      const i01 = (y1 * srcW + x0) * channels;
      const i11 = (y1 * srcW + x1) * channels;

      const dstIdx = (dy * dstW + dx) * 3;

      for (let c = 0; c < 3; c++) {
        const v =
          src[i00 + c]! * (1 - fx) * (1 - fy) +
          src[i10 + c]! * fx * (1 - fy) +
          src[i01 + c]! * (1 - fx) * fy +
          src[i11 + c]! * fx * fy;
        dst[dstIdx + c] = Math.round(v);
      }
    }
  }

  return dst;
}
