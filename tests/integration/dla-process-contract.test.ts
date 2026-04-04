import { describe, expect, it } from 'vitest';
import { preprocessImage } from '../../src/dla-process/preprocess';
import { postprocessDetections } from '../../src/dla-process/postprocess';

describe('DLA preprocess/postprocess contracts', () => {
  it('preprocesses RGBA pixels into NCHW tensor with letterbox padding', () => {
    const image = {
      width: 2,
      height: 1,
      channels: 4 as const,
      data: Buffer.from([
        255, 0, 0, 255,
        0, 255, 0, 255,
      ]),
    };

    const result = preprocessImage(image, 4);
    const planeSize = 16;
    const topLeftPad = 0;
    const firstContentPixel = 4;

    expect(result.tensor).toHaveLength(3 * 4 * 4);
    expect(result.letterbox).toMatchObject({
      scale: 2,
      padX: 0,
      padY: 1,
      newWidth: 4,
      newHeight: 2,
      targetSize: 4,
    });
    expect(result.tensor[topLeftPad]).toBeCloseTo(114 / 255, 5);
    expect(result.tensor[firstContentPixel]).toBeCloseTo(1, 5);
    expect(result.tensor[planeSize + firstContentPixel]).toBeCloseTo(0, 5);
    expect(result.tensor[planeSize * 2 + firstContentPixel]).toBeCloseTo(0, 5);
  });

  it('decodes row-major detections back to normalized page coordinates', () => {
    const blocks = postprocessDetections(
      new Float32Array([
        10, 20, 110, 70, 0.95, 1,
        0, 0, 3, 3, 0.1, 2,
      ]),
      2,
      { scale: 2, padX: 10, padY: 20, newWidth: 200, newHeight: 100, targetSize: 256 },
      0,
      100,
      50,
      { confidenceThreshold: 0.25 },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'text',
      bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
      pageIndex: 0,
    });
    expect(blocks[0]?.confidence).toBeCloseTo(0.95, 5);
  });

  it('supports transposed YOLO output and filters invalid detections', () => {
    const blocks = postprocessDetections(
      new Float32Array([
        5, 30, 40, 50, 60, 70, 80,
        5, 40, 50, 60, 70, 80, 90,
        45, 40, 50, 60, 70, 80, 90,
        45, 40, 50, 60, 70, 80, 90,
        0.8, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
        0, 99, 99, 99, 99, 99, 99,
      ]),
      7,
      { scale: 1, padX: 0, padY: 0, newWidth: 120, newHeight: 120, targetSize: 120 },
      2,
      120,
      120,
      { confidenceThreshold: 0.25 },
      [1, 6, 7],
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'title',
      bbox: { x: 5 / 120, y: 5 / 120, w: 40 / 120, h: 40 / 120 },
      pageIndex: 2,
    });
    expect(blocks[0]?.confidence).toBeCloseTo(0.8, 5);
  });
});