/**
 * WorkingMemory — cross-operation memory that persists within a research session.
 *
 * Cross-operation memory that spans
 * ALL interactions: chat, pipeline results, user behavior, AI suggestions.
 *
 * Entries are scored by recency and relevance, and older entries decay.
 * The orchestrator injects top-K entries into the system prompt.
 */

// ─── Types ───

export type MemoryEntryType =
  | 'finding'       // A piece of knowledge discovered during research
  | 'decision'      // A decision made by the user or AI
  | 'question'      // An open question that needs answering
  | 'artifact'      // A created artifact (note, annotation, memo)
  | 'observation'   // An observation about the user's behavior/focus
  | 'comparison';   // A cross-entity comparison result

export interface WorkingMemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  /** Where this entry came from */
  source: string;
  /** Linked entity IDs (papers, concepts, notes) */
  linkedEntities: string[];
  /** Importance score (0-1). Decays over time. */
  importance: number;
  createdAt: number;
  /** Last time this entry was referenced/used */
  lastAccessedAt: number;
  /** Optional tags for filtering */
  tags?: string[];
}

export interface MemoryRecallOptions {
  topK?: number;
  type?: MemoryEntryType;
  linkedEntity?: string;
  linkedEntitiesAny?: string[];
  minImportance?: number;
  allowedTypes?: MemoryEntryType[];
  maxAgeMs?: number;
}

export interface MemoryPromptFormatOptions {
  allowedTypes?: MemoryEntryType[];
  maxAgeMs?: number;
  linkedEntitiesAny?: string[];
}

// ─── Working Memory ───

export class WorkingMemory {
  private entries: WorkingMemoryEntry[] = [];
  private readonly maxEntries: number;
  private static readonly DECAY_RATE = 0.0001; // importance decay per second
  private static readonly MIN_IMPORTANCE = 0.05;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  /**
   * Add an entry to working memory.
   */
  add(entry: Omit<WorkingMemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt'>): WorkingMemoryEntry {
    const now = Date.now();
    const full: WorkingMemoryEntry = {
      ...entry,
      id: generateId(),
      createdAt: now,
      lastAccessedAt: now,
    };

    this.entries.push(full);

    // Evict lowest-importance entries if over capacity
    if (this.entries.length > this.maxEntries) {
      this.applyDecay();
      this.entries.sort((a, b) => b.importance - a.importance);
      this.entries = this.entries.slice(0, this.maxEntries);
    }

    return full;
  }

  /**
   * Retrieve top-K entries, scored by importance with time decay.
   * Optionally filter by type or linked entity.
   */
  recall(opts: MemoryRecallOptions = {}): WorkingMemoryEntry[] {
    const {
      topK = 10,
      type,
      linkedEntity,
      linkedEntitiesAny,
      minImportance = 0,
      allowedTypes,
      maxAgeMs,
    } = opts;

    this.applyDecay();

    let filtered = this.entries;

    if (type) {
      filtered = filtered.filter((e) => e.type === type);
    }
    if (allowedTypes && allowedTypes.length > 0) {
      const allowed = new Set<MemoryEntryType>(allowedTypes);
      filtered = filtered.filter((e) => allowed.has(e.type));
    }
    if (linkedEntity) {
      filtered = filtered.filter((e) => e.linkedEntities.includes(linkedEntity));
    }
    if (linkedEntitiesAny && linkedEntitiesAny.length > 0) {
      const linkedSet = new Set(linkedEntitiesAny);
      filtered = filtered.filter((e) => e.linkedEntities.some((id) => linkedSet.has(id)));
    }
    if (minImportance > 0) {
      filtered = filtered.filter((e) => e.importance >= minImportance);
    }
    if (maxAgeMs !== undefined) {
      const now = Date.now();
      filtered = filtered.filter((e) => now - e.createdAt <= maxAgeMs);
    }

    return filtered
      .sort((a, b) => b.importance - a.importance)
      .slice(0, topK)
      .map((e) => {
        // Mark as accessed
        e.lastAccessedAt = Date.now();
        return e;
      });
  }

  /**
   * Get entries related to specific entities.
   */
  getRelated(entityIds: string[], topK = 5): WorkingMemoryEntry[] {
    const entitySet = new Set(entityIds);
    return this.entries
      .filter((e) => e.linkedEntities.some((id) => entitySet.has(id)))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, topK);
  }

  /**
   * Boost importance of an entry (e.g., when referenced again).
   */
  boost(entryId: string, amount = 0.2): void {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.importance = Math.min(1, entry.importance + amount);
      entry.lastAccessedAt = Date.now();
    }
  }

  /**
   * Remove an entry by ID.
   */
  remove(entryId: string): void {
    this.entries = this.entries.filter((e) => e.id !== entryId);
  }

  /**
   * Format top entries for injection into system prompt.
   */
  formatForPrompt(
    topK = 8,
    opts: MemoryPromptFormatOptions = {},
  ): string {
    const top = this.recall({
      topK,
      minImportance: WorkingMemory.MIN_IMPORTANCE,
      ...(opts.allowedTypes ? { allowedTypes: opts.allowedTypes } : {}),
      ...(opts.maxAgeMs !== undefined ? { maxAgeMs: opts.maxAgeMs } : {}),
      ...(opts.linkedEntitiesAny ? { linkedEntitiesAny: opts.linkedEntitiesAny } : {}),
    });
    if (top.length === 0) return '';

    const lines = top.map((e) => {
      const age = formatAge(Date.now() - e.createdAt);
      const entities = e.linkedEntities.length > 0
        ? ` [${e.linkedEntities.join(', ')}]`
        : '';
      return `- [${e.type}] ${e.content}${entities} (${age} ago)`;
    });

    return `<working_memory>\n${lines.join('\n')}\n</working_memory>`;
  }

  /**
   * Apply time decay to all entry importance scores.
   */
  private applyDecay(): void {
    const now = Date.now();
    for (const entry of this.entries) {
      const elapsedSec = (now - entry.lastAccessedAt) / 1000;
      entry.importance = Math.max(
        WorkingMemory.MIN_IMPORTANCE,
        entry.importance - elapsedSec * WorkingMemory.DECAY_RATE,
      );
    }
    // Prune entries below minimum importance
    this.entries = this.entries.filter((e) => e.importance >= WorkingMemory.MIN_IMPORTANCE);
  }

  /** Current entry count */
  get size(): number {
    return this.entries.length;
  }

  /** Get all entries (for serialization) */
  getAll(): WorkingMemoryEntry[] {
    return [...this.entries];
  }

  /** Clear all entries */
  clear(): void {
    this.entries = [];
  }

  /**
   * Remove observation entries older than maxAgeMs.
   * Returns the number of entries removed.
   * Call this proactively (e.g., on each user message) to ensure stale
   * observations never surface in prompts or affect gate decisions.
   */
  purgeStaleObservations(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => e.type !== 'observation' || e.createdAt > cutoff,
    );
    return before - this.entries.length;
  }

  /** Restore entries from persistence (e.g., on startup). Applies decay to imported entries. */
  loadEntries(entries: WorkingMemoryEntry[]): void {
    this.entries = entries;
    this.applyDecay();
  }
}

// ─── Helpers ───

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatAge(ms: number): string {
  if (ms < 60_000) return '<1min';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min`;
  return `${Math.floor(ms / 3_600_000)}h`;
}
