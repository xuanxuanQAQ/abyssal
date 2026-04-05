import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConfig, silentLogger } from '../../src/__test-utils__/test-db';

const {
  computeSha256Mock,
  validatePdfMock,
  downloadPdfMock,
  deleteFileIfExistsMock,
  tryFastPathMock,
  buildStrategyMock,
} = vi.hoisted(() => ({
  computeSha256Mock: vi.fn(),
  validatePdfMock: vi.fn(),
  downloadPdfMock: vi.fn(),
  deleteFileIfExistsMock: vi.fn(),
  tryFastPathMock: vi.fn(),
  buildStrategyMock: vi.fn(),
}));

vi.mock('../../src/core/infra/http-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/infra/http-client')>('../../src/core/infra/http-client');
  return {
    ...actual,
    computeSha256: (...args: unknown[]) => computeSha256Mock(...args),
  };
});

vi.mock('../../src/core/acquire/pdf-validator', () => ({
  validatePdf: (...args: unknown[]) => validatePdfMock(...args),
}));

vi.mock('../../src/core/acquire/downloader', () => ({
  downloadPdf: (...args: unknown[]) => downloadPdfMock(...args),
  deleteFileIfExists: (...args: unknown[]) => deleteFileIfExistsMock(...args),
}));

vi.mock('../../src/core/acquire/fast-path', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/acquire/fast-path')>('../../src/core/acquire/fast-path');
  return {
    ...actual,
    tryFastPath: (...args: unknown[]) => tryFastPathMock(...args),
  };
});

vi.mock('../../src/core/acquire/strategy', async () => {
  const actual = await vi.importActual<typeof import('../../src/core/acquire/strategy')>('../../src/core/acquire/strategy');
  return {
    ...actual,
    buildStrategy: (...args: unknown[]) => buildStrategyMock(...args),
  };
});

vi.mock('mupdf', () => ({}));

import { AcquireService } from '../../src/core/acquire';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('AcquireService cascade integration', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    computeSha256Mock.mockResolvedValue('sha256-cascade-test');
    validatePdfMock.mockResolvedValue({ valid: true, reason: null });
    deleteFileIfExistsMock.mockImplementation((filePath: string) => {
      try { fs.unlinkSync(filePath); } catch {}
    });
    tryFastPathMock.mockReturnValue({ matched: false, pdfUrl: null, source: null });
  });

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves candidate order, records failures, and stops once a later candidate succeeds', async () => {
    const tempDir = makeTempDir('abyssal-acquire-cascade-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: false,
        enableRecon: false,
        enableSpeculativeExecution: false,
        enableFuzzyResolve: false,
        maxRetries: 0,
      },
    });
    const failureMemory = {
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };

    buildStrategyMock.mockReturnValue({
      simpleCandidates: [
        {
          id: 'candidate-0',
          source: 'openalex-oa',
          url: 'https://example.test/first.pdf',
          score: 90,
          headers: {},
          complex: false,
          skipPreflight: true,
          useProxy: false,
          scoreBreakdown: { base: 90 },
        },
        {
          id: 'candidate-1',
          source: 'crossref-pdf',
          url: 'https://example.test/second.pdf',
          score: 80,
          headers: {},
          complex: false,
          skipPreflight: true,
          useProxy: false,
          scoreBreakdown: { base: 80 },
        },
      ],
      complexCandidates: [],
    });

    downloadPdfMock.mockImplementation(async (_http: unknown, url: string, tempPath: string) => {
      if (url.includes('first')) {
        throw new Error('first candidate failed');
      }
      fs.writeFileSync(tempPath, '%PDF-1.4\nsecond-candidate');
    });

    const service = new AcquireService(config, silentLogger);
    service.setFailureMemory(failureMemory as any);

    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
    });

    expect(result.status).toBe('success');
    expect(result.source).toBe('crossref-pdf');
    expect(result.attempts.map((attempt) => [attempt.source, attempt.status])).toEqual([
      ['openalex-oa', 'failed'],
      ['crossref-pdf', 'success'],
    ]);
    expect(downloadPdfMock).toHaveBeenCalledTimes(2);
    expect(failureMemory.recordSuccess).toHaveBeenCalledWith('crossref-pdf', '10.1000/test-doi', null);
    expect(failureMemory.recordFailure).not.toHaveBeenCalled();
  });

  it('surfaces an exhausted cascade as an ordered attempt list and records all failed sources', async () => {
    const tempDir = makeTempDir('abyssal-acquire-cascade-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: false,
        enableRecon: false,
        enableSpeculativeExecution: false,
        enableFuzzyResolve: false,
        maxRetries: 0,
      },
      apiKeys: {
        ...baseConfig.apiKeys,
        unpaywallEmail: 'test@example.com',
      },
    });
    const failureMemory = {
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };

    buildStrategyMock.mockReturnValue({
      simpleCandidates: [
        {
          id: 'candidate-0',
          source: 'publisher-direct',
          url: 'https://example.test/publisher.pdf',
          score: 60,
          headers: {},
          complex: false,
          skipPreflight: false,
          useProxy: false,
          scoreBreakdown: { base: 60 },
        },
      ],
      complexCandidates: [],
    });

    downloadPdfMock.mockRejectedValue(new Error('publisher failed'));

    const service = new AcquireService(config, silentLogger);
    service.setFailureMemory(failureMemory as any);

    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
    });

    expect(result.status).toBe('failed');
    expect(result.attempts[0]).toMatchObject({ source: 'publisher-direct', status: 'failed' });
    expect(failureMemory.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      source: 'publisher-direct',
      doiPrefix: '10.1000',
      detail: 'publisher failed',
    }));
    expect(failureMemory.recordSuccess).not.toHaveBeenCalled();
  });
});