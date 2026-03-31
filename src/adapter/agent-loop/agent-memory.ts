/**
 * Agent Memory System — three-tier memory for persistent agent context.
 *
 * Tiers:
 * 1. Working Memory: current conversation context (ephemeral, per-session)
 * 2. Short-term Memory: recent tool results and findings (session-scoped, compactable)
 * 3. Long-term Memory: learned facts, user preferences, paper insights (persisted to DB)
 *
 * Working memory is managed by the agent loop itself (conversation.messages).
 * This module manages short-term and long-term memory.
 */

// ─── Types ───

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'preference' | 'insight' | 'tool_finding';
  content: string;
  /** Source: which tool call or user message created this memory */
  source: string;
  /** Relevance score (0-1): decays over time for short-term, stable for long-term */
  relevance: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

export interface AgentMemoryConfig {
  /** Max short-term entries before eviction */
  shortTermCapacity: number;
  /** Max long-term entries before pruning */
  longTermCapacity: number;
  /** Decay factor per hour for short-term relevance (0-1) */
  shortTermDecayRate: number;
}

const DEFAULT_CONFIG: AgentMemoryConfig = {
  shortTermCapacity: 50,
  longTermCapacity: 200,
  shortTermDecayRate: 0.1,
};

// ─── AgentMemory ───

export class AgentMemory {
  private shortTerm: MemoryEntry[] = [];
  private longTerm: MemoryEntry[] = [];
  private readonly config: AgentMemoryConfig;
  private idCounter = 0;

  constructor(config: Partial<AgentMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add a short-term memory (tool finding, intermediate result). */
  addShortTerm(content: string, source: string, type: MemoryEntry['type'] = 'tool_finding'): string {
    const id = `stm_${++this.idCounter}`;
    const entry: MemoryEntry = {
      id,
      type,
      content,
      source,
      relevance: 1.0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
    };
    this.shortTerm.push(entry);
    this.evictShortTerm();
    return id;
  }

  /** Promote a short-term memory to long-term (accessed frequently or explicitly saved). */
  promote(shortTermId: string): boolean {
    const idx = this.shortTerm.findIndex((e) => e.id === shortTermId);
    if (idx === -1) return false;

    const entry = this.shortTerm.splice(idx, 1)[0]!;
    entry.id = `ltm_${++this.idCounter}`;
    entry.relevance = 1.0; // Reset relevance for long-term
    this.longTerm.push(entry);
    this.pruneLongTerm();
    return true;
  }

  /** Add directly to long-term memory. */
  addLongTerm(content: string, source: string, type: MemoryEntry['type'] = 'fact'): string {
    const id = `ltm_${++this.idCounter}`;
    const entry: MemoryEntry = {
      id,
      type,
      content,
      source,
      relevance: 1.0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
    };
    this.longTerm.push(entry);
    this.pruneLongTerm();
    return id;
  }

  /** Retrieve memories relevant to a query (keyword match + recency). */
  recall(query: string, topK: number = 5): MemoryEntry[] {
    const now = Date.now();
    const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    const scored = [...this.shortTerm, ...this.longTerm].map((entry) => {
      const content = entry.content.toLowerCase();
      // Keyword overlap score
      const keywordHits = keywords.filter((kw) => content.includes(kw)).length;
      const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;

      // Recency score (decays over hours)
      const hoursAgo = (now - entry.lastAccessedAt) / 3_600_000;
      const recencyScore = Math.exp(-0.1 * hoursAgo);

      // Combined score
      const score = entry.relevance * (0.6 * keywordScore + 0.3 * recencyScore + 0.1);

      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK).filter((s) => s.score > 0.05).map((s) => s.entry);

    // Update access stats
    for (const entry of results) {
      entry.lastAccessedAt = now;
      entry.accessCount++;
    }

    return results;
  }

  /** Format memories as context for injection into system prompt. */
  formatForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return '';
    const lines = memories.map((m) =>
      `- [${m.type}] ${m.content} (source: ${m.source})`,
    );
    return `<agent_memory>\n${lines.join('\n')}\n</agent_memory>`;
  }

  /** Get all memories (for persistence). */
  getAll(): { shortTerm: MemoryEntry[]; longTerm: MemoryEntry[] } {
    return {
      shortTerm: [...this.shortTerm],
      longTerm: [...this.longTerm],
    };
  }

  /** Restore from persisted state. */
  restore(data: { shortTerm?: MemoryEntry[]; longTerm?: MemoryEntry[] }): void {
    if (data.shortTerm) this.shortTerm = [...data.shortTerm];
    if (data.longTerm) this.longTerm = [...data.longTerm];
  }

  /** Clear all short-term memory (e.g., on session change). */
  clearShortTerm(): void {
    this.shortTerm = [];
  }

  // ─── Internal ───

  private evictShortTerm(): void {
    if (this.shortTerm.length <= this.config.shortTermCapacity) return;
    // Apply decay, then evict lowest relevance
    const now = Date.now();
    for (const entry of this.shortTerm) {
      const hoursAgo = (now - entry.createdAt) / 3_600_000;
      entry.relevance *= Math.exp(-this.config.shortTermDecayRate * hoursAgo);
    }
    this.shortTerm.sort((a, b) => b.relevance - a.relevance);
    this.shortTerm = this.shortTerm.slice(0, this.config.shortTermCapacity);
  }

  private pruneLongTerm(): void {
    if (this.longTerm.length <= this.config.longTermCapacity) return;
    // Prune least accessed entries
    this.longTerm.sort((a, b) => b.accessCount - a.accessCount || b.relevance - a.relevance);
    this.longTerm = this.longTerm.slice(0, this.config.longTermCapacity);
  }
}
