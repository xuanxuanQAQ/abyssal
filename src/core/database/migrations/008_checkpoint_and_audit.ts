/**
 * 008_checkpoint_and_audit — Workflow checkpoints + LLM audit log
 *
 * 1. workflow_checkpoints: crash recovery for long-running workflows
 * 2. llm_audit_log: persistent LLM call records for cost tracking and debugging
 */

import type Database from 'better-sqlite3';
import type { AbyssalConfig } from '../../types/config';

export function migrate(db: Database.Database, _config: AbyssalConfig): void {
  // ─── Workflow Checkpoints ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_type TEXT NOT NULL,
      paper_id TEXT,
      step_index INTEGER NOT NULL DEFAULT 0,
      step_name TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'in_progress',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_wfc_paper_id ON workflow_checkpoints(paper_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wfc_status ON workflow_checkpoints(status)`);

  // ─── LLM Audit Log ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL DEFAULT NULL,
      paper_id TEXT DEFAULT NULL,
      finish_reason TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_lla_workflow_id ON llm_audit_log(workflow_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lla_created_at ON llm_audit_log(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lla_model ON llm_audit_log(model)`);
}
