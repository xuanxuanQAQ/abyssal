/**
 * Decision Injector — format decision history for prompt injection.
 *
 * §6.1: Build structured prompt section from reviewed mappings + decision files.
 *
 * Groups mappings by decision status:
 *   - Accepted: "use as reliable evidence"
 *   - Revised: "use researcher's corrected version"
 *   - Rejected: "DO NOT use as evidence" (recovered from decision files)
 */

import type Database from 'better-sqlite3';
import {
  loadDecisionEntry,
  loadRejectedFromDecisionFiles,
  parseEvidenceJson,
  type RejectedFromFile,
} from '../../core/database/decision-query';

// ─── Types ───

interface MappingRow {
  paper_id: string;
  concept_id: string;
  relation: string;
  confidence: number;
  evidence: string | null;
  reviewed: number;
  decision_status: string | null;
  decision_note: string | null;
  title: string;
  year: number;
}

// ─── §6.1: Format decision history for synthesize prompt ───

/**
 * Build the "Researcher's Judgments on This Concept" prompt section.
 *
 * Queries all reviewed mappings for the concept, loads decision entries
 * from .md files, and formats into three groups.
 */
export function formatDecisionHistoryForPrompt(
  conceptId: string,
  db: Database.Database,
  workspaceRoot: string,
): string {
  // Query reviewed mappings for this concept
  const mappings = db.prepare(
    'SELECT pcm.*, p.title, p.year ' +
    'FROM paper_concept_map pcm ' +
    'JOIN papers p ON p.id = pcm.paper_id ' +
    'WHERE pcm.concept_id = ? AND pcm.reviewed = 1 ' +
    'ORDER BY pcm.confidence DESC',
  ).all(conceptId) as MappingRow[];

  const accepted: Array<MappingRow & { note: string | null }> = [];
  const revised: Array<MappingRow & { decision: NonNullable<ReturnType<typeof loadDecisionEntry>> }> = [];

  for (const mapping of mappings) {
    const decision = loadDecisionEntry(mapping.paper_id, conceptId, workspaceRoot);

    if (!decision || decision.status === 'accepted') {
      // No decision file or accepted — treat as accepted
      accepted.push({ ...mapping, note: decision?.note ?? mapping.decision_note });
    } else if (decision.status === 'revised') {
      revised.push({ ...mapping, decision });
    }
    // rejected mappings are already deleted from paper_concept_map
  }

  // Recover rejected from decision files
  const rejected = loadRejectedFromDecisionFiles(conceptId, db, workspaceRoot);

  // Format
  return formatSections(accepted, revised, rejected);
}

// ─── Format into prompt sections ───

function formatSections(
  accepted: Array<MappingRow & { note: string | null }>,
  revised: Array<MappingRow & { decision: NonNullable<ReturnType<typeof loadDecisionEntry>> }>,
  rejected: RejectedFromFile[],
): string {
  const lines: string[] = ["## Researcher's Judgments on This Concept\n"];

  if (accepted.length > 0) {
    lines.push('### Accepted Mappings (use as reliable evidence)');
    for (const m of accepted) {
      const evidence = parseEvidenceJson(m.evidence);
      lines.push(`- **${m.title}** (${m.year}): ${m.relation}, conf=${m.confidence}`);
      if (m.note) lines.push(`  Note: "${m.note}"`);
    }
  }

  if (revised.length > 0) {
    lines.push("\n### Revised Mappings (use researcher's corrected version)");
    for (const m of revised) {
      const d = m.decision;
      const oldRel = d.changes?.oldRelation ?? m.relation;
      const oldConf = d.changes?.oldConfidence ?? m.confidence;
      const newRel = d.changes?.newRelation ?? m.relation;
      const newConf = d.changes?.newConfidence ?? m.confidence;
      lines.push(
        `- **${m.title}** (${m.year}): ` +
        `AI said "${oldRel}" (${oldConf}) → ` +
        `Researcher revised to "${newRel}" (${newConf})`,
      );
      if (d.reason) lines.push(`  Reason: "${d.reason}"`);
    }
  }

  if (rejected.length > 0) {
    lines.push('\n### \u274C Rejected Mappings (DO NOT use as evidence)');
    for (const r of rejected) {
      const d = r.decision;
      lines.push(
        `- **${r.title}** (${r.year}): AI said "${d.originalRelation ?? '?'}" (${d.originalConfidence ?? '?'})`,
      );
      if (d.reason) lines.push(`  Rejection reason: "${d.reason}"`);
    }
  }

  const total = accepted.length + revised.length + rejected.length;
  if (total > 0) {
    lines.push(
      `\nTotal: ${accepted.length} accepted, ${revised.length} revised, ${rejected.length} rejected out of ${total} reviewed.`,
    );
  }

  return lines.join('\n');
}
