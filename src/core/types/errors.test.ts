import {
  AbyssalError,
  PdfCorruptedError,
  NetworkError,
  PaperNotFoundError,
  IntegrityError,
  OcrFailedError,
} from './errors';

// ─── 1. AbyssalError construction ───

describe('AbyssalError construction', () => {
  it('stores message, code, context, and defaults recoverable to false', () => {
    const err = new AbyssalError({
      message: 'something broke',
      code: 'TEST_CODE',
      context: { detail: 42 },
    });

    expect(err.message).toBe('something broke');
    expect(err.code).toBe('TEST_CODE');
    expect(err.context).toEqual({ detail: 42 });
    expect(err.recoverable).toBe(false);
  });

  it('has a valid ISO-8601 timestamp', () => {
    const before = new Date().toISOString();
    const err = new AbyssalError({ message: 'x', code: 'T' });
    const after = new Date().toISOString();

    expect(err.timestamp).toBeDefined();
    expect(err.timestamp >= before).toBe(true);
    expect(err.timestamp <= after).toBe(true);
  });

  it('defaults context to an empty object when omitted', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(err.context).toEqual({});
  });

  it('is an instance of Error', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AbyssalError);
  });
});

// ─── 2. toJSON ───

describe('AbyssalError.toJSON()', () => {
  it('serializes all fields correctly', () => {
    const err = new AbyssalError({
      message: 'boom',
      code: 'BOOM',
      context: { key: 'value' },
      recoverable: true,
    });

    const json = err.toJSON();

    expect(json).toEqual({
      name: 'AbyssalError',
      code: 'BOOM',
      message: 'boom',
      context: { key: 'value' },
      recoverable: true,
      timestamp: err.timestamp,
      cause: undefined,
    });
  });

  it('includes cause message when a cause is provided', () => {
    const root = new Error('root cause');
    const err = new AbyssalError({
      message: 'wrapper',
      code: 'WRAP',
      cause: root,
    });

    const json = err.toJSON();
    expect(json.cause).toBe('root cause');
  });

  it('sets cause to undefined when no cause is provided', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(err.toJSON().cause).toBeUndefined();
  });
});

// ─── 3. fromJSON round-trip ───

describe('AbyssalError.fromJSON()', () => {
  it('round-trips a base AbyssalError via toJSON -> fromJSON', () => {
    const original = new AbyssalError({
      message: 'round-trip',
      code: 'RT',
      context: { a: 1 },
      recoverable: true,
    });

    const restored = AbyssalError.fromJSON(original.toJSON());

    expect(restored).toBeInstanceOf(AbyssalError);
    expect(restored.message).toBe('round-trip');
    expect(restored.code).toBe('RT');
    expect(restored.context).toEqual({ a: 1 });
    expect(restored.recoverable).toBe(true);
  });

  it('round-trips PdfCorruptedError and preserves instanceof', () => {
    const original = new PdfCorruptedError({
      message: 'corrupted',
      context: { pdfPath: '/tmp/x.pdf', corruptionType: 'parse_failure' },
    });

    const restored = AbyssalError.fromJSON(original.toJSON());

    expect(restored).toBeInstanceOf(PdfCorruptedError);
    expect(restored).toBeInstanceOf(AbyssalError);
    expect(restored.message).toBe('corrupted');
    expect(restored.code).toBe('PDF_CORRUPTED');
  });

  it('round-trips NetworkError and preserves instanceof', () => {
    const original = new NetworkError({ message: 'timeout' });
    const restored = AbyssalError.fromJSON(original.toJSON());

    expect(restored).toBeInstanceOf(NetworkError);
    expect(restored).toBeInstanceOf(AbyssalError);
  });

  it('round-trips IntegrityError and preserves instanceof', () => {
    const original = new IntegrityError({
      message: 'bad data',
      context: { dbPath: ':memory:' },
    });
    const restored = AbyssalError.fromJSON(original.toJSON());

    expect(restored).toBeInstanceOf(IntegrityError);
    expect(restored.context).toEqual({ dbPath: ':memory:' });
  });

  it('falls back to AbyssalError for unknown class names', () => {
    const json = {
      name: 'UnknownError',
      code: 'UNKNOWN',
      message: 'who',
      context: {},
      recoverable: false,
      timestamp: new Date().toISOString(),
      cause: undefined,
    };

    const restored = AbyssalError.fromJSON(json);
    expect(restored).toBeInstanceOf(AbyssalError);
    expect(restored.message).toBe('who');
  });
});

// ─── 4. isAbyssalError ───

describe('AbyssalError.isAbyssalError()', () => {
  it('returns true for an AbyssalError instance', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(AbyssalError.isAbyssalError(err)).toBe(true);
  });

  it('returns true for a subclass instance', () => {
    const err = new PdfCorruptedError({ message: 'x' });
    expect(AbyssalError.isAbyssalError(err)).toBe(true);
  });

  it('returns true for a plain object with the correct shape', () => {
    const duck = {
      code: 'SOME_CODE',
      recoverable: false,
      timestamp: new Date().toISOString(),
    };
    expect(AbyssalError.isAbyssalError(duck)).toBe(true);
  });

  it('returns false for a random object missing required fields', () => {
    expect(AbyssalError.isAbyssalError({ foo: 'bar' })).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(AbyssalError.isAbyssalError(null)).toBe(false);
    expect(AbyssalError.isAbyssalError(undefined)).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(AbyssalError.isAbyssalError(new Error('nope'))).toBe(false);
  });

  it('returns false when code is not a string', () => {
    const bad = { code: 123, recoverable: false, timestamp: 'now' };
    expect(AbyssalError.isAbyssalError(bad)).toBe(false);
  });

  it('returns false when recoverable is not a boolean', () => {
    const bad = { code: 'X', recoverable: 'yes', timestamp: 'now' };
    expect(AbyssalError.isAbyssalError(bad)).toBe(false);
  });
});

// ─── 5. Subclass instanceof chain ───

describe('subclass instanceof chain', () => {
  it('PdfCorruptedError is instanceof AbyssalError and Error', () => {
    const err = new PdfCorruptedError({
      message: 'test',
      context: { pdfPath: '/tmp/x.pdf', corruptionType: 'parse_failure' },
    });
    expect(err).toBeInstanceOf(PdfCorruptedError);
    expect(err).toBeInstanceOf(AbyssalError);
    expect(err).toBeInstanceOf(Error);
  });

  it('NetworkError is instanceof AbyssalError and Error', () => {
    const err = new NetworkError({ message: 'timeout' });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err).toBeInstanceOf(AbyssalError);
    expect(err).toBeInstanceOf(Error);
  });

  it('PaperNotFoundError is instanceof AbyssalError and Error', () => {
    const err = new PaperNotFoundError({ message: 'missing' });
    expect(err).toBeInstanceOf(PaperNotFoundError);
    expect(err).toBeInstanceOf(AbyssalError);
    expect(err).toBeInstanceOf(Error);
  });

  it('OcrFailedError is instanceof AbyssalError and Error', () => {
    const err = new OcrFailedError({ message: 'ocr broke' });
    expect(err).toBeInstanceOf(OcrFailedError);
    expect(err).toBeInstanceOf(AbyssalError);
    expect(err).toBeInstanceOf(Error);
  });

  it('IntegrityError is instanceof AbyssalError and Error', () => {
    const err = new IntegrityError({
      message: 'bad data',
      context: { dbPath: ':memory:' },
    });
    expect(err).toBeInstanceOf(IntegrityError);
    expect(err).toBeInstanceOf(AbyssalError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── 6. Subclass preserves name ───

describe('subclass preserves name', () => {
  it('PdfCorruptedError.name equals "PdfCorruptedError"', () => {
    const err = new PdfCorruptedError({
      message: 'test',
      context: { pdfPath: '/tmp/x.pdf', corruptionType: 'parse_failure' },
    });
    expect(err.name).toBe('PdfCorruptedError');
  });

  it('NetworkError.name equals "NetworkError"', () => {
    const err = new NetworkError({ message: 'timeout' });
    expect(err.name).toBe('NetworkError');
  });

  it('PaperNotFoundError.name equals "PaperNotFoundError"', () => {
    const err = new PaperNotFoundError({ message: 'missing' });
    expect(err.name).toBe('PaperNotFoundError');
  });

  it('IntegrityError.name equals "IntegrityError"', () => {
    const err = new IntegrityError({
      message: 'bad',
      context: { dbPath: ':memory:' },
    });
    expect(err.name).toBe('IntegrityError');
  });

  it('OcrFailedError.name equals "OcrFailedError"', () => {
    const err = new OcrFailedError({ message: 'ocr broke' });
    expect(err.name).toBe('OcrFailedError');
  });
});

// ─── 7. Recoverable flag ───

describe('recoverable flag', () => {
  it('AbyssalError defaults recoverable to false', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(err.recoverable).toBe(false);
  });

  it('AbyssalError can set recoverable to true', () => {
    const err = new AbyssalError({
      message: 'x',
      code: 'T',
      recoverable: true,
    });
    expect(err.recoverable).toBe(true);
  });

  it('NetworkError defaults recoverable to true', () => {
    const err = new NetworkError({ message: 'timeout' });
    expect(err.recoverable).toBe(true);
  });

  it('PdfCorruptedError defaults recoverable to false', () => {
    const err = new PdfCorruptedError({ message: 'corrupt' });
    expect(err.recoverable).toBe(false);
  });
});

// ─── 8. Cause chain ───

describe('cause chain', () => {
  it('preserves cause via constructor', () => {
    const root = new Error('root');
    const err = new AbyssalError({
      message: 'wrapper',
      code: 'WRAP',
      cause: root,
    });

    expect(err.cause).toBe(root);
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('root');
  });

  it('supports nested AbyssalError cause chains', () => {
    const root = new NetworkError({ message: 'connection reset' });
    const wrapper = new AbyssalError({
      message: 'operation failed',
      code: 'OP_FAIL',
      cause: root,
    });

    expect(wrapper.cause).toBe(root);
    expect(wrapper.cause).toBeInstanceOf(NetworkError);
  });

  it('cause defaults to undefined when not provided', () => {
    const err = new AbyssalError({ message: 'x', code: 'T' });
    expect(err.cause).toBeUndefined();
  });

  it('subclass preserves cause', () => {
    const root = new Error('disk failure');
    const err = new PdfCorruptedError({
      message: 'cannot read pdf',
      cause: root,
    });

    expect(err.cause).toBe(root);
    expect((err.cause as Error).message).toBe('disk failure');
  });
});
