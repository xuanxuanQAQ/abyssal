/**
 * Cost tracker — session-level LLM cost accounting with optional DB persistence.
 *
 * Tracks per-call cost, aggregates by model/workflow, exposes via getCostStats().
 * When a persistFn is provided, each record is also written to llm_audit_log table.
 *
 * See spec: section 8 — Cost Tracker
 */

// ─── Pricing table ───

export interface ModelPricing {
  inputPer1M: number;  // USD per 1M input tokens
  outputPer1M: number; // USD per 1M output tokens
}

const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4':        { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4':          { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-opus-4-20250514': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'gpt-4o':                 { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'gpt-4o-mini':            { inputPer1M: 0.15,  outputPer1M: 0.60  },
  'o3':                     { inputPer1M: 10.00, outputPer1M: 40.00 },
  'o3-mini':                { inputPer1M: 1.10,  outputPer1M: 4.40  },
  'deepseek-chat':          { inputPer1M: 0.14,  outputPer1M: 0.28  },
  'deepseek-reasoner':      { inputPer1M: 0.55,  outputPer1M: 2.19  },
  'text-embedding-3-small': { inputPer1M: 0.02,  outputPer1M: 0.00  },
  'text-embedding-3-large': { inputPer1M: 0.13,  outputPer1M: 0.00  },
  'rerank-v3.5':            { inputPer1M: 2.00,  outputPer1M: 0.00  },
};

function getPricing(model: string): ModelPricing {
  // Exact match
  if (BUILTIN_PRICING[model]) return BUILTIN_PRICING[model];
  // Local models are free
  if (model.startsWith('ollama/') || model.startsWith('vllm/')) {
    return { inputPer1M: 0, outputPer1M: 0 };
  }
  // Prefix match (e.g., 'claude-sonnet-4-xxx' → 'claude-sonnet-4')
  for (const [key, pricing] of Object.entries(BUILTIN_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  // Unknown model — assume zero (conservative: don't overcount)
  return { inputPer1M: 0, outputPer1M: 0 };
}

// ─── Types ───

export interface CostRecord {
  timestamp: string;
  model: string;
  provider: string;
  workflowId: string | null;
  paperId: string | null;
  conceptId: string | null;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  durationMs: number;
}

export interface AggregateEntry {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  callCount: number;
}

export interface CostStats {
  session: AggregateEntry;
  byModel: Record<string, AggregateEntry>;
  byWorkflow: Record<string, AggregateEntry>;
  recentCalls: CostRecord[];
}

// ─── Persistence callback type ───

/** Optional callback to persist audit records to database. */
export type AuditPersistFn = (entry: {
  workflowId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
  paperId: string | null;
  finishReason: string | null;
}) => void;

// ─── CostTracker ───

/** Maximum number of detailed records kept in memory. */
const MAX_RECORDS = 500;

export class CostTracker {
  private readonly records: CostRecord[] = [];
  private readonly byModel = new Map<string, AggregateEntry>();
  private readonly byWorkflow = new Map<string, AggregateEntry>();
  private sessionTotal: AggregateEntry = { inputTokens: 0, outputTokens: 0, totalCost: 0, callCount: 0 };
  private persistFn: AuditPersistFn | null = null;

  /** Attach a persistence callback (e.g., to write to llm_audit_log table). */
  setPersistFn(fn: AuditPersistFn): void {
    this.persistFn = fn;
  }

  /**
   * Record a completed LLM call.
   */
  record(params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    workflowId?: string | null;
    paperId?: string | null;
    conceptId?: string | null;
  }): CostRecord {
    const pricing = getPricing(params.model);
    const inputCost = (params.inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (params.outputTokens / 1_000_000) * pricing.outputPer1M;
    const totalCost = inputCost + outputCost;

    const record: CostRecord = {
      timestamp: new Date().toISOString(),
      model: params.model,
      provider: params.provider,
      workflowId: params.workflowId ?? null,
      paperId: params.paperId ?? null,
      conceptId: params.conceptId ?? null,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      inputCost,
      outputCost,
      totalCost,
      durationMs: params.durationMs,
    };

    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records.shift();
    }
    this.addToAggregate(this.sessionTotal, record);
    this.addToMapAggregate(this.byModel, params.model, record);
    if (params.workflowId) {
      this.addToMapAggregate(this.byWorkflow, params.workflowId, record);
    }

    // Persist to DB audit log (fire-and-forget, non-blocking)
    if (this.persistFn) {
      try {
        this.persistFn({
          workflowId: record.workflowId,
          model: record.model,
          provider: record.provider,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          durationMs: record.durationMs,
          costUsd: record.totalCost,
          paperId: record.paperId,
          finishReason: null,
        });
      } catch {
        // Non-critical: audit log failure should never break the main flow
      }
    }

    return record;
  }

  /**
   * Get aggregated cost statistics for UI display.
   */
  getCostStats(): CostStats {
    return {
      session: { ...this.sessionTotal },
      byModel: Object.fromEntries(
        Array.from(this.byModel.entries()).map(([k, v]) => [k, { ...v }]),
      ),
      byWorkflow: Object.fromEntries(
        Array.from(this.byWorkflow.entries()).map(([k, v]) => [k, { ...v }]),
      ),
      recentCalls: this.records.slice(-20),
    };
  }

  private addToAggregate(agg: AggregateEntry, rec: CostRecord): void {
    agg.inputTokens += rec.inputTokens;
    agg.outputTokens += rec.outputTokens;
    agg.totalCost += rec.totalCost;
    agg.callCount += 1;
  }

  private addToMapAggregate(map: Map<string, AggregateEntry>, key: string, rec: CostRecord): void {
    let agg = map.get(key);
    if (!agg) {
      agg = { inputTokens: 0, outputTokens: 0, totalCost: 0, callCount: 0 };
      map.set(key, agg);
    }
    this.addToAggregate(agg, rec);
  }
}
