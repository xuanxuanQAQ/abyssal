import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConfig, silentLogger } from '../../__test-utils__/test-db';

const {
  computeSha256Mock,
  validatePdfMock,
  downloadPdfMock,
  deleteFileIfExistsMock,
  tryFastPathMock,
  buildStrategyMock,
  tryUnpaywallMock,
} = vi.hoisted(() => ({
  computeSha256Mock: vi.fn(),
  validatePdfMock: vi.fn(),
  downloadPdfMock: vi.fn(),
  deleteFileIfExistsMock: vi.fn(),
  tryFastPathMock: vi.fn(),
  buildStrategyMock: vi.fn(),
  tryUnpaywallMock: vi.fn(),
}));

vi.mock('../infra/http-client', async () => {
  const actual = await vi.importActual<typeof import('../infra/http-client')>('../infra/http-client');
  return {
    ...actual,
    computeSha256: (...args: unknown[]) => computeSha256Mock(...args),
  };
});

vi.mock('./pdf-validator', () => ({
  validatePdf: (...args: unknown[]) => validatePdfMock(...args),
}));

vi.mock('./downloader', () => ({
  downloadPdf: (...args: unknown[]) => downloadPdfMock(...args),
  deleteFileIfExists: (...args: unknown[]) => deleteFileIfExistsMock(...args),
}));

vi.mock('./fast-path', async () => {
  const actual = await vi.importActual<typeof import('./fast-path')>('./fast-path');
  return {
    ...actual,
    tryFastPath: (...args: unknown[]) => tryFastPathMock(...args),
  };
});

vi.mock('./strategy', async () => {
  const actual = await vi.importActual<typeof import('./strategy')>('./strategy');
  return {
    ...actual,
    buildStrategy: (...args: unknown[]) => buildStrategyMock(...args),
  };
});

vi.mock('./sources/unpaywall', () => ({
  tryUnpaywall: (...args: unknown[]) => tryUnpaywallMock(...args),
}));

vi.mock('mupdf', () => ({}));

import { AcquireService } from './index';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('AcquireService runtime branches', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    validatePdfMock.mockResolvedValue({ valid: true, reason: null });
    buildStrategyMock.mockReturnValue({ simpleCandidates: [], complexCandidates: [] });
    computeSha256Mock.mockResolvedValue('sha256-test-value');
    deleteFileIfExistsMock.mockImplementation((filePath: string) => {
      try { fs.unlinkSync(filePath); } catch {}
    });
  });

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns a structured no-identifier failure when no identifiers or title-based sources are available', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const config = createTestConfig({
      acquire: {
        ...createTestConfig().acquire,
        enableFastPath: false,
        enableRecon: false,
        enableSpeculativeExecution: false,
        enableFuzzyResolve: false,
        enableCnki: false,
        enableWanfang: false,
      },
    });

    const service = new AcquireService(config, silentLogger);
    const result = await service.acquireFulltext({
      doi: null,
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
    });

    expect(result.status).toBe('failed');
    expect(result.pdfPath).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      source: 'pipeline',
      status: 'skipped',
      failureCategory: 'no_identifier',
    });
  });

  it('recovers from a fast-path failure by falling back to unpaywall', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: true,
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

    tryFastPathMock.mockReturnValue({
      matched: true,
      pdfUrl: 'https://example.test/fast.pdf',
      source: 'arxiv',
    });
    downloadPdfMock.mockRejectedValue(new Error('fast-path download failed'));
    tryUnpaywallMock.mockImplementation(async (
      _http: unknown,
      _limiter: unknown,
      _doi: string,
      _email: string,
      tempPath: string,
    ) => {
      fs.writeFileSync(tempPath, '%PDF-1.4\nrecovered');
      return {
        source: 'unpaywall',
        status: 'success',
        durationMs: 12,
        httpStatus: 200,
      };
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
    expect(result.source).toBe('unpaywall');
    expect(result.pdfPath).toBe(savePath);
    expect(fs.existsSync(savePath)).toBe(true);
    expect(result.attempts.map((attempt) => [attempt.source, attempt.status])).toEqual([
      ['arxiv', 'failed'],
      ['unpaywall', 'success'],
    ]);
    expect(failureMemory.recordSuccess).toHaveBeenCalledWith('unpaywall', '10.1000/test-doi', null);
    expect(failureMemory.recordFailure).not.toHaveBeenCalled();
  });

  it('returns suspicious when sanity checking flags the downloaded pdf as the wrong paper', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: true,
        enableRecon: false,
        enableSpeculativeExecution: false,
        enableFuzzyResolve: false,
        enableContentSanityCheck: true,
      },
    });
    const failureMemory = {
      recordFailure: vi.fn(),
      recordSuccess: vi.fn(),
    };

    tryFastPathMock.mockReturnValue({
      matched: true,
      pdfUrl: 'https://example.test/fast.pdf',
      source: 'arxiv',
    });
    downloadPdfMock.mockImplementation(async (_http: unknown, _url: string, tempPath: string) => {
      fs.writeFileSync(tempPath, '%PDF-1.4\nfast-path');
    });

    const service = new AcquireService(config, silentLogger);
    service.setFailureMemory(failureMemory as any);
    (service as any).quickExtractText = vi.fn().mockResolvedValue('A'.repeat(200));
    (service as any).sanityChecker = {
      check: vi.fn().mockResolvedValue({
        verdict: 'wrong_paper',
        confidence: 0.99,
        explanation: 'metadata mismatch',
      }),
    };

    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
      paperTitle: 'Expected Paper Title',
      paperAuthors: ['Alice'],
      paperYear: 2024,
    });

    expect(result.status).toBe('suspicious');
    expect(result.source).toBe('arxiv');
    expect(result.pdfPath).toBe(savePath);
    expect(fs.existsSync(savePath)).toBe(true);
    expect(failureMemory.recordSuccess).not.toHaveBeenCalled();
    expect(failureMemory.recordFailure).not.toHaveBeenCalled();
  });

  it('records failure-memory entries when all acquire sources are exhausted', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'paper.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: true,
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

    tryFastPathMock.mockReturnValue({
      matched: true,
      pdfUrl: 'https://example.test/fast.pdf',
      source: 'arxiv',
    });
    downloadPdfMock.mockRejectedValue(new Error('fast-path download failed'));
    tryUnpaywallMock.mockResolvedValue({
      source: 'unpaywall',
      status: 'failed',
      durationMs: 12,
      failureReason: 'upstream timeout',
      failureCategory: 'timeout',
      httpStatus: null,
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

    expect(result.status).toBe('failed');
    expect(failureMemory.recordSuccess).not.toHaveBeenCalled();
    expect(failureMemory.recordFailure).toHaveBeenCalledTimes(2);
    expect(failureMemory.recordFailure).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: 'arxiv',
      failureType: 'unknown',
      doiPrefix: '10.1000',
      detail: 'fast-path download failed',
    }));
    expect(failureMemory.recordFailure).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: 'unpaywall',
      failureType: 'timeout',
      doiPrefix: '10.1000',
      detail: 'upstream timeout',
    }));
  });

  it('returns cached success when savePath already contains a valid pdf', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'cached.pdf');
    fs.writeFileSync(savePath, '%PDF-1.4\ncached');

    const service = new AcquireService(createTestConfig(), silentLogger);
    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
    });

    expect(result.status).toBe('success');
    expect(result.source).toBe('cached');
    expect(result.pdfPath).toBe(savePath);
    expect(result.attempts).toEqual([]);
    expect(downloadPdfMock).not.toHaveBeenCalled();
    expect(tryUnpaywallMock).not.toHaveBeenCalled();
  });

  it('continues to download when an existing cached file fails pdf validation', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'cached-invalid.pdf');
    fs.writeFileSync(savePath, 'not-a-real-pdf');
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

    validatePdfMock
      .mockResolvedValueOnce({ valid: false, reason: 'corrupted' })
      .mockResolvedValueOnce({ valid: true, reason: null });
    tryUnpaywallMock.mockImplementation(async (
      _http: unknown,
      _limiter: unknown,
      _doi: string,
      _email: string,
      tempPath: string,
    ) => {
      fs.writeFileSync(tempPath, '%PDF-1.4\nre-downloaded');
      return {
        source: 'unpaywall',
        status: 'success',
        durationMs: 8,
        httpStatus: 200,
      };
    });

    const service = new AcquireService(config, silentLogger);
    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
    });

    expect(result.status).toBe('success');
    expect(result.source).toBe('unpaywall');
    expect(tryUnpaywallMock).toHaveBeenCalledTimes(1);
  });

  it('skips sanity checking for large pdfs to avoid expensive extraction work', async () => {
    const tempDir = makeTempDir('abyssal-acquire-runtime-');
    createdDirs.push(tempDir);
    const savePath = path.join(tempDir, 'large.pdf');
    const baseConfig = createTestConfig();
    const config = createTestConfig({
      acquire: {
        ...baseConfig.acquire,
        enableFastPath: true,
        enableRecon: false,
        enableSpeculativeExecution: false,
        enableFuzzyResolve: false,
        enableContentSanityCheck: true,
      },
    });

    tryFastPathMock.mockReturnValue({
      matched: true,
      pdfUrl: 'https://example.test/fast.pdf',
      source: 'arxiv',
    });
    downloadPdfMock.mockImplementation(async (_http: unknown, _url: string, tempPath: string) => {
      fs.writeFileSync(tempPath, '%PDF-1.4\nsmall-temp');
      fs.truncateSync(tempPath, 51 * 1024 * 1024);
    });

    const service = new AcquireService(config, silentLogger);
    const quickExtractSpy = vi.spyOn(service as any, 'quickExtractText');
    const sanityCheckSpy = vi.spyOn((service as any).sanityChecker, 'check');

    const result = await service.acquireFulltext({
      doi: '10.1000/test-doi',
      arxivId: null,
      pmcid: null,
      url: null,
      savePath,
      paperTitle: 'Large PDF',
      paperAuthors: ['Alice'],
      paperYear: 2024,
    });

    expect(result.status).toBe('success');
    expect(quickExtractSpy).not.toHaveBeenCalled();
    expect(sanityCheckSpy).not.toHaveBeenCalled();
  });
});