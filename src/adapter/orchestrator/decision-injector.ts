/**
 * Decision Injector — format decision history for prompt injection.
 *
 * §6.1: Build structured prompt section from reviewed mappings + decision data.
 *
 * Groups mappings by decision status:
 *   - Accepted: "use as reliable evidence"
 *   - Revised: "use researcher's corrected version"
 *   - Rejected: "DO NOT use as evidence"
 */

// ─── Service interface (no raw SQLite dependency) ───

export interface ReviewedMapping {
  paperId: string;
  conceptId: string;
  relation: string;
  confidence: number;
  evidence: string | null;
  decisionStatus: 'accepted' | 'revised' | 'rejected' | null;
  decisionNote: string | null;
  title: string;
  year: number;
  /** For revised mappings: original values before researcher correction */
  revisedRelation?: string | null;
  revisedConfidence?: number | null;
  revisionReason?: string | null;
}

export interface RejectedMapping {
  paperId: string;
  title: string;
  year: number;
  originalRelation: string | null;
  originalConfidence: number | null;
  reason: string | null;
}

export interface DecisionInjectorDb {
  /** Get all reviewed mappings for a concept, sorted by confidence desc. */
  getReviewedMappingsForConcept(conceptId: string): Promise<ReviewedMapping[]>;
  /** Get rejected mappings for a concept (kept in DB with decision_status='rejected'). */
  getRejectedMappingsForConcept(conceptId: string): Promise<RejectedMapping[]>;
}

// ─── §6.1: Format decision history for synthesize prompt ───

/**
 * Build the "Researcher's Judgments on This Concept" prompt section.
 *
 * Queries reviewed + rejected mappings via the injected DB interface
 * and formats them into three groups.
 */
export async function formatDecisionHistoryForPrompt(
  conceptId: string,
  db: DecisionInjectorDb,
): Promise<string> {
  const mappings = await db.getReviewedMappingsForConcept(conceptId);

  const accepted: Array<ReviewedMapping & { note: string | null }> = [];
  const revised: ReviewedMapping[] = [];

  for (const m of mappings) {
    if (!m.decisionStatus || m.decisionStatus === 'accepted') {
      accepted.push({ ...m, note: m.decisionNote });
    } else if (m.decisionStatus === 'revised') {
      revised.push(m);
    }
    // rejected mappings are fetched separately
  }

  const rejected = await db.getRejectedMappingsForConcept(conceptId);

  return formatSections(accepted, revised, rejected);
}

// ─── Format into prompt sections ───

function formatSections(
  accepted: Array<ReviewedMapping & { note: string | null }>,
  revised: ReviewedMapping[],
  rejected: RejectedMapping[],
): string {
  const lines: string[] = ["## Researcher's Judgments on This Concept\n"];

  if (accepted.length > 0) {
    lines.push('### Accepted Mappings (use as reliable evidence)');
    for (const m of accepted) {
      lines.push(`- **${m.title}** (${m.year}): ${m.relation}, conf=${m.confidence}`);
      if (m.note) lines.push(`  Note: "${m.note}"`);
    }
  }

  if (revised.length > 0) {
    lines.push("\n### Revised Mappings (use researcher's corrected version)");
    for (const m of revised) {
      const oldRel = m.relation;
      const oldConf = m.confidence;
      const newRel = m.revisedRelation ?? m.relation;
      const newConf = m.revisedConfidence ?? m.confidence;
      lines.push(
        `- **${m.title}** (${m.year}): ` +
        `AI said "${oldRel}" (${oldConf}) → ` +
        `Researcher revised to "${newRel}" (${newConf})`,
      );
      if (m.revisionReason) lines.push(`  Reason: "${m.revisionReason}"`);
    }
  }

  if (rejected.length > 0) {
    lines.push('\n### \u274C Rejected Mappings (DO NOT use as evidence)');
    for (const r of rejected) {
      lines.push(
        `- **${r.title}** (${r.year}): AI said "${r.originalRelation ?? '?'}" (${r.originalConfidence ?? '?'})`,
      );
      if (r.reason) lines.push(`  Rejection reason: "${r.reason}"`);
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
