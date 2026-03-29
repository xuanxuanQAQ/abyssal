/**
 * Decision Query — data supply for review UI and pipeline injection.
 *
 * §3.1-3.2: getMappingReviewData() — structured data for MappingReviewPanel
 * §6.2: loadRejectedFromDecisionFiles() — recover deleted rejected mappings from .md files
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import {
  parseDecisionFile,
  type DecisionEntry,
} from './decision-parser';

// ─── Types ───

export interface BilingualEvidenceDisplay {
  en: string;
  original: string;
  originalLang: string;
  chunkId: string | null;
  page: number | null;
  annotationId: string | null;
}

export interface ReviewableMapping {
  conceptId: string;
  conceptName: string;
  conceptMaturity: string;
  relation: string;
  confidence: number;
  reviewed: boolean;
  evidence: BilingualEvidenceDisplay;
  existingDecision: DecisionEntry | null;
}

export interface MappingReviewData {
  paperId: string;
  paperTitle: string;
  paperYear: number;
  paperLang: string;
  mappings: ReviewableMapping[];
}

export interface RejectedFromFile {
  paperId: string;
  title: string;
  year: number;
  decision: DecisionEntry;
}

// ─── §3.2: Get mapping review data ───

/**
 * Build the complete data structure for MappingReviewPanel.
 */
export function getMappingReviewData(
  db: Database.Database,
  paperId: string,
  workspaceRoot: string,
): MappingReviewData {
  // Paper metadata
  const paper = db.prepare(
    'SELECT id, title, year, abstract FROM papers WHERE id = ?',
  ).get(paperId) as { id: string; title: string; year: number; abstract: string | null } | undefined;

  if (!paper) {
    return {
      paperId,
      paperTitle: 'Unknown',
      paperYear: 0,
      paperLang: 'en',
      mappings: [],
    };
  }

  // Mappings with concept info
  const rows = db.prepare(
    'SELECT pcm.*, c.name_en, c.maturity ' +
    'FROM paper_concept_map pcm ' +
    'JOIN concepts c ON c.id = pcm.concept_id ' +
    'WHERE pcm.paper_id = ? ' +
    'ORDER BY pcm.confidence DESC',
  ).all(paperId) as Array<Record<string, unknown>>;

  // Load existing decisions
  const decisionPath = path.join(workspaceRoot, 'decisions', `${paperId}.md`);
  const existingDecisions = new Map<string, DecisionEntry>();
  const doc = parseDecisionFile(decisionPath);
  if (doc) {
    for (const entry of doc.entries) {
      existingDecisions.set(entry.conceptId, entry);
    }
  }

  // Build review data
  const mappings: ReviewableMapping[] = rows.map((row) => ({
    conceptId: String(row['concept_id']),
    conceptName: String(row['name_en'] ?? ''),
    conceptMaturity: String(row['maturity'] ?? 'working'),
    relation: String(row['relation'] ?? 'supports'),
    confidence: Number(row['confidence'] ?? 0),
    reviewed: row['reviewed'] === 1,
    evidence: parseEvidenceJson(row['evidence']),
    existingDecision: existingDecisions.get(String(row['concept_id'])) ?? null,
  }));

  return {
    paperId,
    paperTitle: paper.title,
    paperYear: paper.year,
    paperLang: detectPaperLanguage(paper.abstract ?? paper.title ?? ''),
    mappings,
  };
}

// ─── §3.2: Evidence JSON parser ───

/**
 * Parse evidence field from database (JSON string or plain text).
 */
export function parseEvidenceJson(evidenceField: unknown): BilingualEvidenceDisplay {
  if (!evidenceField || typeof evidenceField !== 'string') {
    return { en: '', original: '', originalLang: 'unknown', chunkId: null, page: null, annotationId: null };
  }

  try {
    const parsed = JSON.parse(evidenceField) as Record<string, unknown>;
    return {
      en: String(parsed['en'] ?? parsed['english'] ?? ''),
      original: String(parsed['original'] ?? parsed['source'] ?? parsed['en'] ?? ''),
      originalLang: String(parsed['original_lang'] ?? parsed['originalLang'] ?? 'unknown'),
      chunkId: parsed['chunk_id'] != null ? String(parsed['chunk_id']) : (parsed['chunkId'] != null ? String(parsed['chunkId']) : null),
      page: parsed['page'] != null ? Number(parsed['page']) : null,
      annotationId: parsed['annotation_id'] != null ? String(parsed['annotation_id']) : (parsed['annotationId'] != null ? String(parsed['annotationId']) : null),
    };
  } catch {
    // Plain string (legacy format)
    return {
      en: evidenceField,
      original: evidenceField,
      originalLang: detectPaperLanguage(evidenceField),
      chunkId: null,
      page: null,
      annotationId: null,
    };
  }
}

// ─── §6.2: Load rejected mappings from decision files ───

/**
 * Load rejected mappings for a concept from the database.
 *
 * Fix #15: Rejected mappings are now kept in paper_concept_map with
 * decision_status='rejected' instead of being DELETEd. This eliminates
 * the O(N) file-system scan that previously caused UI freezes.
 */
export function loadRejectedMappings(
  conceptId: string,
  db: Database.Database,
): RejectedFromFile[] {
  const rows = db.prepare(
    'SELECT pcm.paper_id, pcm.relation, pcm.confidence, pcm.decision_note, ' +
    '  p.title, p.year ' +
    'FROM paper_concept_map pcm ' +
    'JOIN papers p ON p.id = pcm.paper_id ' +
    "WHERE pcm.concept_id = ? AND pcm.decision_status = 'rejected'",
  ).all(conceptId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    paperId: String(row['paper_id']),
    title: String(row['title']),
    year: Number(row['year']),
    decision: {
      status: 'rejected' as const,
      conceptId,
      relation: null,
      confidence: null,
      note: null,
      changes: null,
      evidence: null,
      reason: row['decision_note'] ? String(row['decision_note']) : null,
      originalRelation: row['relation'] ? String(row['relation']) : null,
      originalConfidence: row['confidence'] != null ? Number(row['confidence']) : null,
    },
  }));
}

/**
 * @deprecated Use loadRejectedMappings (DB-backed) instead. Kept for fallback.
 */
export function loadRejectedFromDecisionFiles(
  conceptId: string,
  db: Database.Database,
  workspaceRoot: string,
): RejectedFromFile[] {
  // Prefer DB query (Fix #15)
  const dbResults = loadRejectedMappings(conceptId, db);
  if (dbResults.length > 0) return dbResults;

  // Fallback: file scan for legacy data (before migration to DB-backed rejection)
  const rejected: RejectedFromFile[] = [];
  const decisionsDir = path.join(workspaceRoot, 'decisions');
  if (!fs.existsSync(decisionsDir)) return rejected;

  let files: string[];
  try {
    files = fs.readdirSync(decisionsDir).filter((f) => f.endsWith('.md'));
  } catch {
    return rejected;
  }

  for (const file of files) {
    try {
      const doc = parseDecisionFile(path.join(decisionsDir, file));
      if (!doc) continue;
      for (const entry of doc.entries) {
        if (entry.status === 'rejected' && entry.conceptId === conceptId) {
          const paper = db.prepare(
            'SELECT title, year FROM papers WHERE id = ?',
          ).get(doc.frontmatter.paperId) as { title: string; year: number } | undefined;
          if (paper) {
            rejected.push({ paperId: doc.frontmatter.paperId, title: paper.title, year: paper.year, decision: entry });
          }
        }
      }
    } catch { continue; }
  }
  return rejected;
}

// ─── §6.1: Load decision entry for a specific paper+concept ───

/**
 * Load a single decision entry from the paper's decision file.
 */
export function loadDecisionEntry(
  paperId: string,
  conceptId: string,
  workspaceRoot: string,
): DecisionEntry | null {
  const decisionPath = path.join(workspaceRoot, 'decisions', `${paperId}.md`);
  const doc = parseDecisionFile(decisionPath);
  if (!doc) return null;

  return doc.entries.find((e) => e.conceptId === conceptId) ?? null;
}

// ─── Helpers ───

function detectPaperLanguage(text: string): string {
  if (!text) return 'en';
  const cjkRatio = (text.match(/[\u4e00-\u9fff]/g) ?? []).length / text.length;
  if (cjkRatio > 0.3) return 'zh-CN';
  return 'en';
}
