import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../infra/http-client';
import type { Logger } from '../infra/logger';
import type { RateLimiter } from '../infra/rate-limiter';
import { ApiError } from '../types/errors';
import { searchByAuthor, searchSemanticScholar } from './semantic-scholar';

function makeDeps(payload: unknown) {
  const http = {
    requestJson: vi.fn().mockResolvedValue(payload),
  } as unknown as HttpClient;

  const limiter = {
    acquire: vi.fn().mockResolvedValue(undefined),
    freeze: vi.fn(),
  } as unknown as RateLimiter;

  const logger = {
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  return { http, limiter, logger };
}

describe('semantic-scholar payload guards', () => {
  it('throws ApiError when paper search data is not an array', async () => {
    const { http, limiter, logger } = makeDeps({ data: { message: 'unexpected' } });

    await expect(
      searchSemanticScholar(http, limiter, null, logger, 'power market', { limit: 1 }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError when author search data is not an array', async () => {
    const { http, limiter, logger } = makeDeps({ data: { message: 'unexpected' } });

    await expect(
      searchByAuthor(http, limiter, null, logger, 'Alice Example', undefined, 1),
    ).rejects.toBeInstanceOf(ApiError);
  });
});