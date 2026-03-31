/**
 * LLM Audit Log DAO — persistent cost and call tracking.
 *
 * Records every LLM API call with model, tokens, cost, duration,
 * and associated workflow/paper for debugging and cost analysis.
 */

import type Database from 'better-sqlite3';

export interface AuditLogEntry {
  id: number;
  workflowId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number | null;
  paperId: string | null;
  finishReason: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface InsertAuditLog {
  workflowId?: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd?: number | null;
  paperId?: string | null;
  finishReason?: string | null;
  errorMessage?: string | null;
}

/** Insert a new audit log entry. Returns the row ID. */
export function insertAuditLog(db: Database.Database, entry: InsertAuditLog): number {
  const result = db.prepare(`
    INSERT INTO llm_audit_log (
      workflow_id, model, provider, input_tokens, output_tokens,
      duration_ms, cost_usd, paper_id, finish_reason, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.workflowId ?? null,
    entry.model,
    entry.provider,
    entry.inputTokens,
    entry.outputTokens,
    entry.durationMs,
    entry.costUsd ?? null,
    entry.paperId ?? null,
    entry.finishReason ?? null,
    entry.errorMessage ?? null,
  );
  return Number(result.lastInsertRowid);
}

/** Query audit log with optional filters. */
export function queryAuditLog(
  db: Database.Database,
  filter?: {
    workflowId?: string;
    model?: string;
    paperId?: string;
    sinceDate?: string;
    limit?: number;
  },
): AuditLogEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.workflowId) {
    conditions.push('workflow_id = ?');
    params.push(filter.workflowId);
  }
  if (filter?.model) {
    conditions.push('model = ?');
    params.push(filter.model);
  }
  if (filter?.paperId) {
    conditions.push('paper_id = ?');
    params.push(filter.paperId);
  }
  if (filter?.sinceDate) {
    conditions.push('created_at >= ?');
    params.push(filter.sinceDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter?.limit ?? 100;

  const rows = db.prepare(`
    SELECT * FROM llm_audit_log ${where}
    ORDER BY id DESC LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map(mapRow);
}

/** Get aggregate cost stats. */
export function getAuditStats(
  db: Database.Database,
  sinceDate?: string,
): {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byModel: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
} {
  const where = sinceDate ? 'WHERE created_at >= ?' : '';
  const params = sinceDate ? [sinceDate] : [];

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM llm_audit_log ${where}
  `).get(...params) as Record<string, number>;

  const byModel = db.prepare(`
    SELECT
      model,
      COUNT(*) as calls,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM llm_audit_log ${where}
    GROUP BY model ORDER BY cost_usd DESC
  `).all(...params) as Array<Record<string, unknown>>;

  return {
    totalCalls: totals['total_calls'] ?? 0,
    totalInputTokens: totals['total_input'] ?? 0,
    totalOutputTokens: totals['total_output'] ?? 0,
    totalCostUsd: totals['total_cost'] ?? 0,
    byModel: byModel.map((r) => ({
      model: r['model'] as string,
      calls: r['calls'] as number,
      inputTokens: r['input_tokens'] as number,
      outputTokens: r['output_tokens'] as number,
      costUsd: r['cost_usd'] as number,
    })),
  };
}

function mapRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row['id'] as number,
    workflowId: row['workflow_id'] as string | null,
    model: row['model'] as string,
    provider: row['provider'] as string,
    inputTokens: row['input_tokens'] as number,
    outputTokens: row['output_tokens'] as number,
    durationMs: row['duration_ms'] as number,
    costUsd: row['cost_usd'] as number | null,
    paperId: row['paper_id'] as string | null,
    finishReason: row['finish_reason'] as string | null,
    errorMessage: row['error_message'] as string | null,
    createdAt: row['created_at'] as string,
  };
}
