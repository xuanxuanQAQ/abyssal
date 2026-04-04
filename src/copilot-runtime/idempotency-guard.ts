/**
 * IdempotencyGuard — prevents duplicate operation submission.
 *
 * Two layers:
 * 1. operationId-based: same operationId is always idempotent
 * 2. fingerprint-based: same surface + selection + prompt within short window (1000-1500ms)
 */

import type { CopilotSurface, IdempotencyKey } from './types';
import * as crypto from 'node:crypto';

const DEFAULT_DEDUPE_WINDOW_MS = 1200;

interface ActiveEntry {
  operationId: string;
  fingerprint: string;
  surface: CopilotSurface;
  submittedAt: number;
  dedupeWindowMs: number;
}

export class IdempotencyGuard {
  private activeOperations = new Map<string, ActiveEntry>();
  private recentFingerprints = new Map<string, ActiveEntry>();

  /**
   * Check if an operation should be deduplicated.
   * Returns the existing operationId if duplicate, null if new.
   */
  checkDuplicate(key: IdempotencyKey): string | null {
    const now = Date.now();

    // 1. Exact operationId match — always idempotent
    const existing = this.activeOperations.get(key.operationId);
    if (existing) {
      return existing.operationId;
    }

    // 2. Fingerprint-based soft dedup within window
    const fpKey = `${key.surface}::${key.fingerprint}`;
    const recent = this.recentFingerprints.get(fpKey);
    if (recent && now - recent.submittedAt < recent.dedupeWindowMs) {
      return recent.operationId;
    }

    return null;
  }

  /** Register a new operation */
  register(key: IdempotencyKey): void {
    const entry: ActiveEntry = {
      operationId: key.operationId,
      fingerprint: key.fingerprint,
      surface: key.surface,
      submittedAt: Date.now(),
      dedupeWindowMs: key.dedupeWindowMs || DEFAULT_DEDUPE_WINDOW_MS,
    };

    this.activeOperations.set(key.operationId, entry);
    this.recentFingerprints.set(`${key.surface}::${key.fingerprint}`, entry);
  }

  /** Mark operation complete and allow fingerprint reuse after window */
  release(operationId: string): void {
    this.activeOperations.delete(operationId);
    // fingerprint entries self-expire via timestamp check
  }

  /** Cleanup expired fingerprint entries */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.recentFingerprints) {
      if (now - entry.submittedAt > entry.dedupeWindowMs) {
        this.recentFingerprints.delete(key);
      }
    }
  }

  /** Build a fingerprint from operation input */
  static buildFingerprint(surface: CopilotSurface, prompt: string, selectionText?: string): string {
    const input = `${surface}|${prompt}|${selectionText ?? ''}`;
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
  }
}
