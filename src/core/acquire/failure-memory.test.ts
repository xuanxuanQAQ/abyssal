import { describe, expect, it, vi } from 'vitest';

import { FailureMemory } from './failure-memory';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('FailureMemory', () => {
  it('reorders sources based on mixed success and failure history', () => {
    const memory = new FailureMemory(null, logger as any);
    const defaults = ['unpaywall', 'pmc', 'scihub'];

    memory.recordFailure({ paperId: 'p1', source: 'unpaywall', failureType: 'timeout', doiPrefix: '10.1000' });
    memory.recordFailure({ paperId: 'p2', source: 'unpaywall', failureType: 'timeout', doiPrefix: '10.1000' });
    memory.recordSuccess('pmc', '10.1000/foo', null);
    memory.recordSuccess('pmc', '10.1000/foo', null);
    memory.recordFailure({ paperId: 'p3', source: 'scihub', failureType: 'http_error', doiPrefix: '10.1000' });

    expect(memory.getSourceOrdering(defaults, '10.1000/foo', null)).toEqual(['pmc', 'unpaywall', 'scihub']);
  });

  it('keeps default ordering when no doiPrefix or publisher history is available', () => {
    const memory = new FailureMemory(null, logger as any);
    const defaults = ['unpaywall', 'pmc'];

    memory.recordFailure({ paperId: 'p1', source: 'unpaywall', failureType: 'timeout', doiPrefix: '10.1000' });

    expect(memory.getSourceOrdering(defaults, null, null)).toEqual(defaults);
  });

  it('loads legacy DB stats with calibration instead of pinning failure rate at 100%', async () => {
    const db = {
      recordAcquireFailure: vi.fn().mockResolvedValue(undefined),
      recordAcquireSuccess: vi.fn().mockResolvedValue(undefined),
      getAcquireFailureStats: vi.fn().mockResolvedValue([
        { source: 'unpaywall', total: 3, failures: 3, doiPrefix: '10.1000' },
        { source: 'pmc', total: 10, failures: 2, doiPrefix: '10.1000' },
      ]),
    };
    const memory = new FailureMemory(db as any, logger as any);

    await memory.loadFromDb();

    expect(memory.getSourceOrdering(['unpaywall', 'pmc'], '10.1000/foo', null)).toEqual(['pmc', 'unpaywall']);
  });
});