import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkingMemory } from './working-memory';

function makeMemory() {
  return new WorkingMemory(50);
}

function addEntry(
  mem: WorkingMemory,
  type: 'finding' | 'decision' | 'observation' | 'artifact' | 'comparison' | 'question',
  content: string,
  createdAgoMs = 0,
) {
  const entry = mem.add({ type, content, source: 'test', linkedEntities: [], importance: 0.8 });
  // Backdating createdAt to simulate age
  if (createdAgoMs > 0) {
    // WorkingMemory.entries is private; use the returned entry ref which points to the same object.
    (entry as { createdAt: number }).createdAt = Date.now() - createdAgoMs;
  }
  return entry;
}

describe('WorkingMemory.purgeStaleObservations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes observation entries older than maxAgeMs', () => {
    const mem = makeMemory();
    const OLD_MS = 35 * 60 * 1000; // 35 min
    const NEW_MS = 10 * 60 * 1000; // 10 min

    addEntry(mem, 'observation', 'old selection', OLD_MS);
    addEntry(mem, 'observation', 'recent selection', NEW_MS);
    addEntry(mem, 'finding', 'a finding', OLD_MS); // should survive

    const purged = mem.purgeStaleObservations(30 * 60 * 1000);

    expect(purged).toBe(1);
    expect(mem.size).toBe(2); // new observation + finding remain
    const remaining = mem.recall({ topK: 10, allowedTypes: ['observation'] });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.content).toBe('recent selection');
  });

  it('returns 0 when nothing is stale', () => {
    const mem = makeMemory();
    addEntry(mem, 'observation', 'fresh', 5 * 60 * 1000); // 5 min old
    expect(mem.purgeStaleObservations(30 * 60 * 1000)).toBe(0);
    expect(mem.size).toBe(1);
  });

  it('does not purge non-observation entries regardless of age', () => {
    const mem = makeMemory();
    addEntry(mem, 'finding', 'old finding', 60 * 60 * 1000); // 1 hour old
    addEntry(mem, 'decision', 'old decision', 60 * 60 * 1000);
    expect(mem.purgeStaleObservations(30 * 60 * 1000)).toBe(0);
    expect(mem.size).toBe(2);
  });

  it('removes all observations when all are stale', () => {
    const mem = makeMemory();
    addEntry(mem, 'observation', 'obs1', 40 * 60 * 1000);
    addEntry(mem, 'observation', 'obs2', 50 * 60 * 1000);
    const purged = mem.purgeStaleObservations(30 * 60 * 1000);
    expect(purged).toBe(2);
    expect(mem.size).toBe(0);
  });
});
