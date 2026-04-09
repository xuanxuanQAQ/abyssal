import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preprocessImage } from '../../src/dla-process/preprocess';
import { postprocessDetections } from '../../src/dla-process/postprocess';

const processHarness = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  sent: [] as unknown[],
  failMupdf: false,
  initSessionMock: vi.fn(),
  detectPageMock: vi.fn(),
  destroySessionMock: vi.fn(),
}));

vi.mock('../../src/dla-process/inference-engine', () => ({
  initSession: (...args: unknown[]) => processHarness.initSessionMock(...args),
  detectPage: (...args: unknown[]) => processHarness.detectPageMock(...args),
  destroySession: (...args: unknown[]) => processHarness.destroySessionMock(...args),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileMock = async (path: string, ...args: unknown[]) => {
    if (typeof path === 'string' && path.includes('package.json')) {
      return Buffer.from('%PDF-1.4 dummy');
    }
    return actual.promises.readFile(path, ...args as [any]);
  };
  const readFileSyncMock = (path: string, ...args: unknown[]) => {
    if (typeof path === 'string' && path.includes('package.json')) {
      return Buffer.from('%PDF-1.4 dummy');
    }
    return actual.readFileSync(path, ...args as [any]);
  };
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: readFileSyncMock,
      promises: { ...actual.promises, readFile: readFileMock },
    },
    readFileSync: readFileSyncMock,
    promises: { ...actual.promises, readFile: readFileMock },
  };
});

vi.mock('mupdf', () => {
  return {
    Document: {
      openDocument: () => {
        if (processHarness.failMupdf) {
          throw new Error('mocked open failure');
        }

        return {
          loadPage: () => ({
            getBounds: () => [0, 0, 100, 200],
            toPixmap: () => ({
              getWidth: () => 100,
              getHeight: () => 200,
              getPixels: () => new Uint8Array(100 * 200 * 3),
              destroy: () => {},
            }),
            destroy: () => {},
          }),
          destroy: () => {},
        };
      },
    },
    Matrix: {
      scale: () => ({ sx: 1, sy: 1 }),
    },
    ColorSpace: {
      DeviceRGB: 'rgb',
    },
  };
});

async function loadProcessMain() {
  vi.resetModules();
  processHarness.handlers.clear();
  processHarness.sent = [];

  const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: any[]) => unknown) => {
    processHarness.handlers.set(event, handler);
    return process;
  }) as typeof process.on);
  const sendSpy = vi.spyOn(process, 'send').mockImplementation(((message: unknown) => {
    processHarness.sent.push(message);
    return true;
  }) as NonNullable<typeof process.send>);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as unknown) as typeof process.exit);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const module = await import('../../src/dla-process/main');

  return {
    messageHandler: processHarness.handlers.get('message')!,
    testing: module.__testing__,
    restore: () => {
      onSpy.mockRestore();
      sendSpy.mockRestore();
      exitSpy.mockRestore();
      logSpy.mockRestore();
      warnSpy.mockRestore();
    },
  };
}

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

describe('DLA subprocess message protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processHarness.handlers.clear();
    processHarness.sent = [];
    processHarness.failMupdf = false;
    processHarness.initSessionMock.mockResolvedValue(undefined);
    processHarness.destroySessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    processHarness.handlers.clear();
    processHarness.sent = [];
  });

  it('returns a lifecycle success envelope when model init succeeds', async () => {
    const main = await loadProcessMain();
    try {
      await main.messageHandler({
        type: 'lifecycle',
        action: 'init',
        payload: { modelPath: 'model.onnx', executionProvider: 'cpu' },
      });

      expect(processHarness.initSessionMock).toHaveBeenCalledWith('model.onnx', 'cpu');
      expect(processHarness.sent).toContainEqual({ type: 'lifecycle', action: 'init', success: true });
    } finally {
      main.restore();
    }
  });

  it('returns a lifecycle failure envelope when model init throws', async () => {
    processHarness.initSessionMock.mockRejectedValueOnce(new Error('model load failed'));
    const main = await loadProcessMain();
    try {
      await main.messageHandler({
        type: 'lifecycle',
        action: 'init',
        payload: { modelPath: 'broken.onnx', executionProvider: 'cpu' },
      });

      expect(processHarness.sent).toContainEqual({
        type: 'lifecycle',
        action: 'init',
        success: false,
        error: 'model load failed',
      });
    } finally {
      main.restore();
    }
  });

  it('streams detect results, per-page errors, and progress envelopes after initialization', async () => {
    processHarness.detectPageMock.mockImplementation(async (_image: unknown, pageIndex: number) => {
      if (pageIndex === 1) {
        throw new Error('page inference failed');
      }
      return {
        blocks: [{ type: 'text', bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.9, pageIndex }],
        inferenceMs: 12,
      };
    });

    const main = await loadProcessMain();
    try {
      await main.messageHandler({
        type: 'lifecycle',
        action: 'init',
        payload: { modelPath: 'model.onnx', executionProvider: 'cpu' },
      });
      processHarness.sent = [];

      await main.messageHandler({
        id: 'detect-1',
        type: 'detect',
        pdfPath: 'c:/Users/xuanxuan/Desktop/abyssal/package.json',
        pageIndices: [0, 1],
        targetSize: 512,
      });

      expect(processHarness.sent).toEqual([
        {
          id: 'detect-1',
          type: 'detect:result',
          pageIndex: 0,
          blocks: [{ type: 'text', bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, confidence: 0.9, pageIndex: 0 }],
          inferenceMs: 12,
        },
        { id: 'detect-1', type: 'detect:progress', completed: 1, total: 2 },
        { id: 'detect-1', type: 'detect:error', message: 'page inference failed', pageIndex: 1 },
        { id: 'detect-1', type: 'detect:progress', completed: 2, total: 2 },
      ]);
    } finally {
      main.restore();
    }
  });

  it('returns a detect error envelope when opening the PDF fails', async () => {
    processHarness.failMupdf = true;
    const main = await loadProcessMain();
    try {
      await main.messageHandler({
        type: 'lifecycle',
        action: 'init',
        payload: { modelPath: 'model.onnx', executionProvider: 'cpu' },
      });
      processHarness.sent = [];

      await main.messageHandler({
        id: 'detect-2',
        type: 'detect',
        pdfPath: 'c:/Users/xuanxuan/Desktop/abyssal/package.json',
        pageIndices: [0],
      });

      expect(processHarness.sent).toEqual([
        {
          id: 'detect-2',
          type: 'detect:error',
          message: 'Failed to open PDF: mocked open failure',
        },
      ]);
    } finally {
      main.restore();
    }
  });

  it('returns a detect error envelope when both primary and fallback mupdf imports fail', async () => {
    const main = await loadProcessMain();
    const primaryImport = vi.fn(async () => {
      throw new Error('primary load failed');
    });
    const fallbackImport = vi.fn(async (_specifier: string) => {
      throw new Error('fallback load failed');
    });

    main.testing.setMupdfImporters({
      primary: primaryImport,
      fallback: fallbackImport,
    });

    try {
      await main.messageHandler({
        type: 'lifecycle',
        action: 'init',
        payload: { modelPath: 'model.onnx', executionProvider: 'cpu' },
      });
      processHarness.sent = [];

      await main.messageHandler({
        id: 'detect-3',
        type: 'detect',
        pdfPath: 'c:/Users/xuanxuan/Desktop/abyssal/package.json',
        pageIndices: [0],
      });

      expect(primaryImport).toHaveBeenCalledTimes(1);
      expect(fallbackImport).toHaveBeenCalledWith('mupdf/dist/mupdf.js');
      expect(processHarness.sent).toEqual([
        {
          id: 'detect-3',
          type: 'detect:error',
          message: 'Failed to load mupdf: fallback load failed',
        },
      ]);
    } finally {
      main.testing.resetMupdfImporters();
      main.restore();
    }
  });
});