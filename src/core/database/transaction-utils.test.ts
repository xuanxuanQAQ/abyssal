import { writeTransaction, withBusyRetry } from './transaction-utils';

// Mock better-sqlite3 Database
function createMockDb(opts?: { failCount?: number }) {
  let callCount = 0;
  const failCount = opts?.failCount ?? 0;

  return {
    transaction: (fn: () => unknown) => {
      const txnFn = Object.assign(
        () => fn(),
        {
          immediate: () => {
            callCount++;
            if (callCount <= failCount) {
              throw new Error('SQLITE_BUSY: database is locked');
            }
            return fn();
          },
          deferred: () => fn(),
          exclusive: () => fn(),
        },
      );
      return txnFn;
    },
    _callCount: () => callCount,
  };
}

describe('writeTransaction', () => {
  it('calls .immediate() not .deferred() or default', () => {
    let calledMethod = '';
    const db = {
      transaction: (fn: () => unknown) => {
        return Object.assign(
          () => { calledMethod = 'default'; return fn(); },
          {
            immediate: () => { calledMethod = 'immediate'; return fn(); },
            deferred: () => { calledMethod = 'deferred'; return fn(); },
            exclusive: () => { calledMethod = 'exclusive'; return fn(); },
          },
        );
      },
    };
    const result = writeTransaction(db as never, () => 42);
    expect(result).toBe(42);
    expect(calledMethod).toBe('immediate');
  });

  it('propagates return value', () => {
    const db = createMockDb();
    const obj = { a: 1, b: 'hello' };
    const result = writeTransaction(db as never, () => obj);
    expect(result).toEqual(obj);
  });

  it('propagates exceptions', () => {
    const db = createMockDb();
    expect(() =>
      writeTransaction(db as never, () => { throw new Error('test error'); }),
    ).toThrow('test error');
  });
});

describe('withBusyRetry', () => {
  it('succeeds without retry', () => {
    const result = withBusyRetry(() => 'ok');
    expect(result).toBe('ok');
  });

  it('retries on SQLITE_BUSY and eventually succeeds', () => {
    let attempts = 0;
    const result = withBusyRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error('SQLITE_BUSY');
        return 'recovered';
      },
      { maxRetries: 5, initialDelayMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('throws after max retries exhausted', () => {
    expect(() =>
      withBusyRetry(
        () => { throw new Error('SQLITE_BUSY'); },
        { maxRetries: 2, initialDelayMs: 1 },
      ),
    ).toThrow('SQLITE_BUSY');
  });

  it('does not retry on non-BUSY errors', () => {
    let attempts = 0;
    expect(() =>
      withBusyRetry(
        () => { attempts++; throw new Error('some other error'); },
        { maxRetries: 3, initialDelayMs: 1 },
      ),
    ).toThrow('some other error');
    expect(attempts).toBe(1);
  });

  it('maxRetries=0 means exactly 1 attempt, no retry', () => {
    let attempts = 0;
    expect(() =>
      withBusyRetry(
        () => { attempts++; throw new Error('SQLITE_BUSY'); },
        { maxRetries: 0, initialDelayMs: 1 },
      ),
    ).toThrow('SQLITE_BUSY');
    expect(attempts).toBe(1);
  });

  it('handles error without .message (non-Error throw)', () => {
    expect(() =>
      withBusyRetry(
        () => { throw 'string error'; },
        { maxRetries: 2, initialDelayMs: 1 },
      ),
    ).toThrow();
  });
});
