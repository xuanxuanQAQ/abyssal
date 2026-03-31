/**
 * Workflow Checkpoint DAO — crash recovery for long-running workflows.
 *
 * Checkpoints record the step index, step name, and serialized state
 * so workflows can resume from the last successful step after a crash.
 */

import type Database from 'better-sqlite3';

export interface WorkflowCheckpoint {
  id: number;
  workflowType: string;
  paperId: string | null;
  stepIndex: number;
  stepName: string;
  stateJson: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

/** Create a new checkpoint at workflow start. Returns the checkpoint ID. */
export function createCheckpoint(
  db: Database.Database,
  workflowType: string,
  paperId: string | null,
  stepName: string,
  stateJson: string = '{}',
): number {
  const result = db.prepare(`
    INSERT INTO workflow_checkpoints (workflow_type, paper_id, step_index, step_name, state_json, status)
    VALUES (?, ?, 0, ?, ?, 'in_progress')
  `).run(workflowType, paperId, stepName, stateJson);
  return Number(result.lastInsertRowid);
}

/** Advance checkpoint to a new step. */
export function advanceCheckpoint(
  db: Database.Database,
  checkpointId: number,
  stepIndex: number,
  stepName: string,
  stateJson: string,
): void {
  db.prepare(`
    UPDATE workflow_checkpoints
    SET step_index = ?, step_name = ?, state_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(stepIndex, stepName, stateJson, checkpointId);
}

/** Mark checkpoint as completed. */
export function completeCheckpoint(db: Database.Database, checkpointId: number): void {
  db.prepare(`
    UPDATE workflow_checkpoints
    SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(checkpointId);
}

/** Mark checkpoint as failed with error message. */
export function failCheckpoint(db: Database.Database, checkpointId: number, errorMessage: string): void {
  db.prepare(`
    UPDATE workflow_checkpoints
    SET status = 'failed', error_message = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(errorMessage, checkpointId);
}

/** Get the latest in-progress checkpoint for a workflow type + paper. */
export function getLatestCheckpoint(
  db: Database.Database,
  workflowType: string,
  paperId: string | null,
): WorkflowCheckpoint | null {
  const row = db.prepare(`
    SELECT * FROM workflow_checkpoints
    WHERE workflow_type = ? AND (paper_id = ? OR (paper_id IS NULL AND ? IS NULL))
      AND status = 'in_progress'
    ORDER BY id DESC LIMIT 1
  `).get(workflowType, paperId, paperId) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row['id'] as number,
    workflowType: row['workflow_type'] as string,
    paperId: row['paper_id'] as string | null,
    stepIndex: row['step_index'] as number,
    stepName: row['step_name'] as string,
    stateJson: row['state_json'] as string,
    status: row['status'] as WorkflowCheckpoint['status'],
    startedAt: row['started_at'] as string,
    updatedAt: row['updated_at'] as string,
    completedAt: row['completed_at'] as string | null,
    errorMessage: row['error_message'] as string | null,
  };
}

/** Clean up old completed/failed checkpoints, keeping the latest N per workflow type. */
export function cleanupCheckpoints(db: Database.Database, keepPerType: number = 10): number {
  const result = db.prepare(`
    DELETE FROM workflow_checkpoints
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY workflow_type ORDER BY id DESC) AS rn
        FROM workflow_checkpoints
      ) WHERE rn <= ?
    )
  `).run(keepPerType);
  return result.changes;
}
