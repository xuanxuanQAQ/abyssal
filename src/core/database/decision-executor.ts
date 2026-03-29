/**
 * Decision Executor — transaction cascade for decision writes.
 *
 * §4: All database operations within a single IMMEDIATE transaction.
 *
 * Step 1: Update paper metadata (relevance, decision_note, date, reviewer)
 * Step 2: Execute each entry (accepted → reviewed=1; revised → overwrite; rejected → delete)
 * Step 3: Handle relevance='excluded' (mark all, clean relations, stale drafts)
 * Post-tx: Async side effects (relations recompute, stale drafts, push, advisory)
 */

import type Database from 'better-sqlite3';
import type { DecisionDocument, DecisionEntry } from './decision-parser';
import { writeTransaction } from './transaction-utils';

// ─── Types ───

export interface ExecutionResult {
  accepted: number;
  revised: number;
  rejected: number;
  excludedCleanup: boolean;
  warnings: string[];
}

export interface ExecutorLogger {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}

// ─── Side effects callback ───

export interface PostDecisionEffects {
  /** Recompute paper_relations for affected paper */
  recomputeRelations?: (paperId: string) => Promise<void>;
  /** Mark concept drafts as stale */
  markDraftsStale?: (conceptIds: string[]) => void;
  /** Push db-changed notification */
  pushDbChange?: (tables: string[], operation: string) => void;
  /** Trigger advisory agent */
  triggerAdvisory?: () => Promise<void>;
}

// ─── §4.1: Main executor ───

/**
 * Execute a complete decision document within a single transaction.
 */
export function executeDecision(
  db: Database.Database,
  paperId: string,
  doc: DecisionDocument,
  logger?: ExecutorLogger,
  effects?: PostDecisionEffects,
): ExecutionResult {
  const warnings: string[] = [];
  let accepted = 0;
  let revised = 0;
  let rejected = 0;
  let excludedCleanup = false;

  writeTransaction(db, () => {
    // Step 1: Update paper metadata
    updatePaperMetadata(db, paperId, doc.frontmatter);

    // Step 2: Execute each entry
    for (const entry of doc.entries) {
      const result = executeOneEntry(db, paperId, entry, logger);
      if (!result) {
        warnings.push(`No matching mapping for ${entry.status} entry: ${entry.conceptId}`);
      }
      switch (entry.status) {
        case 'accepted': accepted++; break;
        case 'revised': revised++; break;
        case 'rejected': rejected++; break;
      }
    }

    // Step 3: Handle excluded
    if (doc.frontmatter.relevance === 'excluded') {
      handleExcludedPaper(db, paperId, logger);
      excludedCleanup = true;
    }
  });

  // Post-transaction async side effects
  triggerPostDecisionEffects(paperId, doc, effects, logger);

  logger?.info('Decision executed', {
    paperId,
    relevance: doc.frontmatter.relevance,
    accepted,
    revised,
    rejected,
    excludedCleanup,
  });

  return { accepted, revised, rejected, excludedCleanup, warnings };
}

// ─── §4.2: Paper metadata update ───

function updatePaperMetadata(
  db: Database.Database,
  paperId: string,
  frontmatter: DecisionDocument['frontmatter'],
): void {
  const timestamp = new Date().toISOString();
  db.prepare(
    'UPDATE papers SET relevance = ?, decision_note = ?, updated_at = ? WHERE id = ?',
  ).run(frontmatter.relevance, frontmatter.decisionNote, timestamp, paperId);
}

// ─── §4.3: Single entry execution ───

function executeOneEntry(
  db: Database.Database,
  paperId: string,
  entry: DecisionEntry,
  logger?: ExecutorLogger,
): boolean {
  switch (entry.status) {
    case 'accepted':
      return executeAccepted(db, paperId, entry, logger);
    case 'revised':
      return executeRevised(db, paperId, entry, logger);
    case 'rejected':
      return executeRejected(db, paperId, entry, logger);
  }
}

// §4.3.1: [accepted]
function executeAccepted(
  db: Database.Database,
  paperId: string,
  entry: DecisionEntry,
  logger?: ExecutorLogger,
): boolean {
  const timestamp = new Date().toISOString();
  const result = db.prepare(
    "UPDATE paper_concept_map SET " +
    "  reviewed = 1, reviewed_at = ?, decision_status = 'accepted', " +
    "  decision_note = ?, updated_at = ? " +
    "WHERE paper_id = ? AND concept_id = ?",
  ).run(timestamp, entry.note, timestamp, paperId, entry.conceptId);

  if (result.changes === 0) {
    logger?.warn('Accepted entry has no matching mapping', {
      paperId, conceptId: entry.conceptId,
    });
    return false;
  }
  return true;
}

// §4.3.2: [revised]
function executeRevised(
  db: Database.Database,
  paperId: string,
  entry: DecisionEntry,
  logger?: ExecutorLogger,
): boolean {
  const timestamp = new Date().toISOString();
  const setClauses: string[] = [
    'reviewed = 1',
    'reviewed_at = ?',
    "decision_status = 'revised'",
    'decision_note = ?',
    'updated_at = ?',
  ];
  const params: unknown[] = [timestamp, entry.reason, timestamp];

  // Overwrite relation if changed
  if (entry.changes?.newRelation) {
    setClauses.push('relation = ?');
    params.push(entry.changes.newRelation);
  }

  // Overwrite confidence if changed
  if (entry.changes?.newConfidence != null) {
    setClauses.push('confidence = ?');
    params.push(entry.changes.newConfidence);
  }

  params.push(paperId, entry.conceptId);

  const result = db.prepare(
    `UPDATE paper_concept_map SET ${setClauses.join(', ')} WHERE paper_id = ? AND concept_id = ?`,
  ).run(...params);

  if (result.changes === 0) {
    logger?.warn('Revised entry has no matching mapping', {
      paperId, conceptId: entry.conceptId,
    });
    return false;
  }
  return true;
}

// §4.3.3: [rejected]
// Fix #15: Mark as rejected instead of DELETE to avoid O(N) file-system scan
// in loadRejectedFromDecisionFiles. Query: WHERE decision_status = 'rejected'.
function executeRejected(
  db: Database.Database,
  paperId: string,
  entry: DecisionEntry,
  logger?: ExecutorLogger,
): boolean {
  const timestamp = new Date().toISOString();
  const result = db.prepare(
    "UPDATE paper_concept_map SET " +
    "  reviewed = 1, decision_status = 'rejected', " +
    "  decision_note = ?, updated_at = ? " +
    "WHERE paper_id = ? AND concept_id = ?",
  ).run(entry.reason, timestamp, paperId, entry.conceptId);

  if (result.changes === 0) {
    logger?.warn('Rejected entry has no matching mapping', {
      paperId, conceptId: entry.conceptId,
    });
    return false;
  }

  logger?.info('Mapping rejected (marked, not deleted)', {
    paperId,
    conceptId: entry.conceptId,
    originalRelation: entry.originalRelation,
    reason: entry.reason,
  });
  return true;
}

// ─── §4.4: Excluded paper cleanup ───

function handleExcludedPaper(
  db: Database.Database,
  paperId: string,
  logger?: ExecutorLogger,
): void {
  const timestamp = new Date().toISOString();

  // 1. Mark all mappings as reviewed + excluded
  db.prepare(
    "UPDATE paper_concept_map SET reviewed = 1, decision_status = 'excluded', updated_at = ? " +
    "WHERE paper_id = ?",
  ).run(timestamp, paperId);

  // 2. Clean derived relations
  db.prepare(
    'DELETE FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
  ).run(paperId, paperId);

  logger?.info('Paper excluded — mappings marked, relations cleaned', { paperId });
}

// ─── §4.5: Post-transaction side effects ───

function triggerPostDecisionEffects(
  paperId: string,
  doc: DecisionDocument,
  effects?: PostDecisionEffects,
  logger?: ExecutorLogger,
): void {
  const hasRejections = doc.entries.some((e) => e.status === 'rejected');

  // Fix #16: Only recompute relations when relation or confidence changed substantially.
  // Evidence-only or note-only revisions don't affect the concept graph.
  const hasSubstantialRevisions = doc.entries.some((e) => {
    if (e.status !== 'revised') return false;
    if (e.changes?.newRelation) return true; // relation changed
    if (e.changes?.newConfidence != null && e.changes?.oldConfidence != null) {
      return Math.abs(e.changes.newConfidence - e.changes.oldConfidence) > 0.05;
    }
    return false;
  });

  // Side effect 1: Relations recompute
  if ((hasSubstantialRevisions || hasRejections) && effects?.recomputeRelations) {
    effects.recomputeRelations(paperId).catch((err) =>
      logger?.warn('Post-decision relations recompute failed', {
        paperId, error: (err as Error).message,
      }),
    );
  }

  // Side effect 2: Stale drafts
  if ((hasSubstantialRevisions || hasRejections) && effects?.markDraftsStale) {
    const affectedConcepts = doc.entries
      .filter((e) => e.status === 'rejected' || (e.status === 'revised' && (e.changes?.newRelation || (e.changes?.newConfidence != null && e.changes?.oldConfidence != null && Math.abs(e.changes.newConfidence - e.changes.oldConfidence) > 0.05))))
      .map((e) => e.conceptId);
    effects.markDraftsStale(affectedConcepts);
  }

  // Side effect 3: DB change push
  if (effects?.pushDbChange) {
    effects.pushDbChange(
      ['papers', 'paper_concept_map', 'paper_relations'],
      'update',
    );
  }

  // Side effect 4: Advisory agent
  if (effects?.triggerAdvisory) {
    effects.triggerAdvisory().catch((err) =>
      logger?.warn('Post-decision advisory failed', {
        error: (err as Error).message,
      }),
    );
  }
}
