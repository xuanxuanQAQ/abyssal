import { IdempotencyGuard } from '../idempotency-guard';
import { makeIdempotencyKey, resetSeq } from './helpers';

describe('IdempotencyGuard', () => {
  let guard: IdempotencyGuard;

  beforeEach(() => {
    guard = new IdempotencyGuard();
    resetSeq();
  });

  describe('checkDuplicate — exact operationId match', () => {
    it('returns null for new operations', () => {
      const key = makeIdempotencyKey({ operationId: 'op-new' });
      expect(guard.checkDuplicate(key)).toBeNull();
    });

    it('returns operationId when same id is registered', () => {
      const key = makeIdempotencyKey({ operationId: 'op-1' });
      guard.register(key);
      expect(guard.checkDuplicate(key)).toBe('op-1');
    });
  });

  describe('checkDuplicate — fingerprint dedup within window', () => {
    it('deduplicates same fingerprint within window', () => {
      const key1 = makeIdempotencyKey({
        operationId: 'op-1',
        surface: 'chat',
        fingerprint: 'fp-same',
        dedupeWindowMs: 5000,
      });
      guard.register(key1);

      const key2 = makeIdempotencyKey({
        operationId: 'op-2',
        surface: 'chat',
        fingerprint: 'fp-same',
        dedupeWindowMs: 5000,
      });
      expect(guard.checkDuplicate(key2)).toBe('op-1');
    });

    it('allows same fingerprint on different surfaces', () => {
      const key1 = makeIdempotencyKey({
        operationId: 'op-1',
        surface: 'chat',
        fingerprint: 'fp-same',
      });
      guard.register(key1);

      const key2 = makeIdempotencyKey({
        operationId: 'op-2',
        surface: 'editor-toolbar',
        fingerprint: 'fp-same',
      });
      expect(guard.checkDuplicate(key2)).toBeNull();
    });
  });

  describe('release', () => {
    it('releases operationId-based entry so exact id no longer deduplicates', () => {
      const key = makeIdempotencyKey({ operationId: 'op-1', fingerprint: 'fp-unique-release' });
      guard.register(key);
      guard.release('op-1');

      // After release, an exact ID check with a NEW fingerprint should pass
      const key2 = makeIdempotencyKey({
        operationId: 'op-new',
        surface: 'editor-toolbar', // different surface so fingerprint doesn't collide
        fingerprint: 'fp-different',
      });
      expect(guard.checkDuplicate(key2)).toBeNull();
    });

    it('fingerprint dedup still active within window after release', () => {
      const key = makeIdempotencyKey({
        operationId: 'op-1',
        surface: 'chat',
        fingerprint: 'fp-same',
        dedupeWindowMs: 5000,
      });
      guard.register(key);
      guard.release('op-1');

      // Same fingerprint + surface within window still deduplicates — by design
      const key2 = makeIdempotencyKey({
        operationId: 'op-2',
        surface: 'chat',
        fingerprint: 'fp-same',
        dedupeWindowMs: 5000,
      });
      expect(guard.checkDuplicate(key2)).toBe('op-1');
    });
  });

  describe('cleanup', () => {
    it('removes expired fingerprint entries', () => {
      vi.useFakeTimers();
      const localGuard = new IdempotencyGuard();

      const key = makeIdempotencyKey({
        operationId: 'op-1',
        surface: 'chat',
        fingerprint: 'fp-old',
        dedupeWindowMs: 100,
      });
      localGuard.register(key);
      localGuard.release('op-1'); // release id-based entry

      // Advance time past the dedup window
      vi.advanceTimersByTime(200);
      localGuard.cleanup();

      const key2 = makeIdempotencyKey({
        operationId: 'op-2',
        surface: 'chat',
        fingerprint: 'fp-old',
      });
      expect(localGuard.checkDuplicate(key2)).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('buildFingerprint', () => {
    it('produces deterministic fingerprints', () => {
      const fp1 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'world');
      const fp2 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'world');
      expect(fp1).toBe(fp2);
    });

    it('produces different fingerprints for different input', () => {
      const fp1 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'world');
      const fp2 = IdempotencyGuard.buildFingerprint('chat', 'hello', 'other');
      expect(fp1).not.toBe(fp2);
    });

    it('returns 16-char hex string', () => {
      const fp = IdempotencyGuard.buildFingerprint('chat', 'test');
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
