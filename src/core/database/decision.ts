/**
 * Decision Module — 裁决文件的解析、执行、查询与生成。
 *
 * 合并自 decision-parser / decision-executor / decision-query / decision-writer，
 * 四个关注点内聚于同一领域概念（裁决文档），合并后减少模块间循环引用和跳转成本。
 *
 * §2: 解析 workspace/decisions/{paper_id}.md → DecisionDocument
 * §3: 查询 — 为 ReviewPanel 和 prompt injection 提供结构化数据
 * §4: 执行 — 单事务更新 paper + mappings + 派生关系
 * §5: 生成 — 序列化裁决到 Markdown 文件
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type Database from 'better-sqlite3';
import { writeTransaction } from './transaction-utils';

// ════════════════════════════════════════
// §2 Types
// ════════════════════════════════════════

export interface DecisionFrontmatter {
  paperId: string;
  date: string;
  reviewer: string;
  relevance: 'high' | 'medium' | 'low' | 'excluded';
  decisionNote: string | null;
  researchNotes?: string | null;
}

export interface DecisionChanges {
  newRelation: string | null;
  oldRelation: string | null;
  newConfidence: number | null;
  oldConfidence: number | null;
}

export interface DecisionEvidence {
  en: string | null;
  original: string | null;
  originalLang: string | null;
}

export interface DecisionEntry {
  status: 'accepted' | 'revised' | 'rejected';
  conceptId: string;
  relation: string | null;
  confidence: number | null;
  note: string | null;
  changes: DecisionChanges | null;
  evidence: DecisionEvidence | null;
  reason: string | null;
  originalRelation: string | null;
  originalConfidence: number | null;
}

export interface DecisionDocument {
  frontmatter: DecisionFrontmatter;
  entries: DecisionEntry[];
  researchNotes: string | null;
  parseWarnings: string[];
}

export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionParseError';
  }
}

// ════════════════════════════════════════
// §2 Parser
// ════════════════════════════════════════

/**
 * Parse a decision file from disk.
 * Returns null if file does not exist (paper not yet reviewed).
 */
export function parseDecisionFile(filePath: string): DecisionDocument | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseDecisionContent(content);
}

/**
 * Parse decision content string into DecisionDocument.
 */
export function parseDecisionContent(content: string): DecisionDocument {
  const warnings: string[] = [];
  const frontmatter = extractFrontmatter(content);
  const entries = extractDecisionEntries(content, warnings);
  const researchNotes = extractResearchNotes(content);
  return { frontmatter, entries, researchNotes, parseWarnings: warnings };
}

// ─── §2.3: Phase 1 — Frontmatter extraction ───

function extractFrontmatter(content: string): DecisionFrontmatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!match) {
    throw new DecisionParseError('Missing YAML frontmatter in decision file');
  }

  let raw: Record<string, unknown>;
  try {
    raw = yaml.load(match[1]!, { schema: yaml.FAILSAFE_SCHEMA }) as Record<string, unknown>;
  } catch (err) {
    throw new DecisionParseError(`Invalid YAML frontmatter: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new DecisionParseError('Frontmatter is not a valid object');
  }

  if (!raw['paper_id']) {
    throw new DecisionParseError('Frontmatter missing required field: paper_id');
  }
  if (!raw['date']) {
    throw new DecisionParseError('Frontmatter missing required field: date');
  }
  if (!raw['relevance']) {
    throw new DecisionParseError('Frontmatter missing required field: relevance');
  }

  const validRelevance = ['high', 'medium', 'low', 'excluded'];
  const relevance = String(raw['relevance']);
  if (!validRelevance.includes(relevance)) {
    throw new DecisionParseError(`Invalid relevance value: "${relevance}"`);
  }

  return {
    paperId: String(raw['paper_id']),
    date: String(raw['date']),
    reviewer: raw['reviewer'] ? String(raw['reviewer']) : 'anonymous',
    relevance: relevance as DecisionFrontmatter['relevance'],
    decisionNote: raw['decision_note'] ? String(raw['decision_note']) : null,
  };
}

// ─── §2.4: Phase 2 — Decision entry extraction ───

function extractDecisionEntries(content: string, warnings: string[]): DecisionEntry[] {
  const sectionMatch = content.match(/##\s*概念映射审核\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/m);
  if (!sectionMatch) {
    warnings.push('No "概念映射审核" section found');
    return [];
  }

  const rawEntries = splitIntoEntries(sectionMatch[1]!);
  const entries: DecisionEntry[] = [];

  for (const raw of rawEntries) {
    const parsed = parseOneEntry(raw, warnings);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

function splitIntoEntries(sectionContent: string): string[] {
  const lines = sectionContent.split('\n');
  const entries: string[] = [];
  let currentEntry: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      if (currentEntry) currentEntry.push('');
      continue;
    }

    if (trimmed.startsWith('- [')) {
      if (currentEntry) entries.push(currentEntry.join('\n'));
      currentEntry = [line];
    } else {
      if (currentEntry) currentEntry.push(line);
    }
  }

  if (currentEntry) entries.push(currentEntry.join('\n'));
  return entries;
}

function parseOneEntry(rawText: string, warnings: string[]): DecisionEntry | null {
  const mainPattern = /^-\s*\[(accepted|revised|rejected)\]\s*(\w+)/m;
  const mainMatch = rawText.match(mainPattern);

  if (!mainMatch) {
    warnings.push(`Unparseable entry: "${rawText.slice(0, 80)}..."`);
    return null;
  }

  const status = mainMatch[1]! as 'accepted' | 'revised' | 'rejected';
  const conceptId = mainMatch[2]!;

  switch (status) {
    case 'accepted':
      return parseAccepted(rawText, conceptId);
    case 'revised':
      return parseRevised(rawText, conceptId, warnings);
    case 'rejected':
      return parseRejected(rawText, conceptId);
  }
}

function parseAccepted(rawText: string, conceptId: string): DecisionEntry {
  const detailPattern = /→\s*(\w+)\s*\(confidence:\s*([\d.]+)\)/;
  const detailMatch = rawText.match(detailPattern);

  const lines = rawText.split('\n');
  const noteLines = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('- ['));
  const note = noteLines.join(' ').trim() || null;

  return {
    status: 'accepted',
    conceptId,
    relation: detailMatch?.[1] ?? null,
    confidence: detailMatch?.[2] ? parseFloat(detailMatch[2]) : null,
    note,
    changes: null,
    evidence: null,
    reason: null,
    originalRelation: null,
    originalConfidence: null,
  };
}

function parseRevised(rawText: string, conceptId: string, warnings: string[]): DecisionEntry {
  const changes: DecisionChanges = {
    newRelation: null,
    oldRelation: null,
    newConfidence: null,
    oldConfidence: null,
  };

  // Pattern A: full change — → new_relation (原: old_relation, confidence: old → new)
  const fullPattern = /→\s*(\w+)\s*\(原:\s*(\w+),\s*confidence:\s*([\d.]+)\s*→\s*([\d.]+)\)/;
  const fullMatch = rawText.match(fullPattern);

  if (fullMatch) {
    changes.newRelation = fullMatch[1]!;
    changes.oldRelation = fullMatch[2]!;
    changes.oldConfidence = parseFloat(fullMatch[3]!);
    changes.newConfidence = parseFloat(fullMatch[4]!);
  } else {
    // Pattern B: relation-only change
    const relationOnly = /→\s*(\w+)\s*\(原:\s*(\w+)\)/;
    const relMatch = rawText.match(relationOnly);
    if (relMatch) {
      changes.newRelation = relMatch[1]!;
      changes.oldRelation = relMatch[2]!;
    }

    // Pattern C: confidence-only change
    const confOnly = /\(confidence:\s*([\d.]+)\s*→\s*([\d.]+)\)/;
    const confMatch = rawText.match(confOnly);
    if (confMatch) {
      changes.oldConfidence = parseFloat(confMatch[1]!);
      changes.newConfidence = parseFloat(confMatch[2]!);
    }
  }

  // Extract bilingual evidence
  const evidence: DecisionEvidence = { en: null, original: null, originalLang: null };

  // Fix #13: Use greedy-to-last-quote to handle embedded quotes
  const enPattern = /EN:\s*"([\s\S]*?)"\s*$/m;
  const enMatch = rawText.match(enPattern);
  if (enMatch) evidence.en = enMatch[1]!.replace(/\n\s*/g, ' ').trim();

  const originalPattern = /原文\[([^\]]+)\]:\s*"([\s\S]*?)"\s*$/m;
  const originalMatch = rawText.match(originalPattern);
  if (originalMatch) {
    evidence.originalLang = originalMatch[1]!;
    evidence.original = originalMatch[2]!;
  }

  // Fix #13: Capture multi-line reason
  const reasonPattern = /修正理由[：:]\s*([\s\S]*?)(?=\n\s*(?:EN:|原文\[|拒绝理由|$))/m;
  const reasonMatch = rawText.match(reasonPattern);
  const reason = reasonMatch?.[1]?.replace(/\n\s*/g, ' ').trim() ?? null;

  if (changes.newRelation == null && changes.newConfidence == null) {
    warnings.push(`[revised] entry for "${conceptId}" has no detectable changes`);
  }

  return {
    status: 'revised',
    conceptId,
    relation: changes.newRelation,
    confidence: changes.newConfidence,
    note: null,
    changes,
    evidence: evidence.en || evidence.original ? evidence : null,
    reason,
    originalRelation: changes.oldRelation,
    originalConfidence: changes.oldConfidence,
  };
}

function parseRejected(rawText: string, conceptId: string): DecisionEntry {
  const origPattern = /\(原:\s*(\w+),\s*confidence:\s*([\d.]+)\)/;
  const origMatch = rawText.match(origPattern);

  // Fix #13: multi-line rejection reason
  const reasonPattern = /拒绝理由[：:]\s*([\s\S]*?)$/m;
  const reasonMatch = rawText.match(reasonPattern);

  return {
    status: 'rejected',
    conceptId,
    relation: null,
    confidence: null,
    note: null,
    changes: null,
    evidence: null,
    reason: reasonMatch?.[1]?.trim() ?? null,
    originalRelation: origMatch?.[1] ?? null,
    originalConfidence: origMatch?.[2] ? parseFloat(origMatch[2]) : null,
  };
}

// ─── §2.5: Phase 3 — Research notes extraction ───

function extractResearchNotes(content: string): string | null {
  const notesMatch = content.match(/##\s*研究笔记\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/m);
  if (!notesMatch) return null;
  const notes = notesMatch[1]!.trim();
  return notes.length > 0 ? notes : null;
}

// ════════════════════════════════════════
// §3 Query
// ════════════════════════════════════════

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

/**
 * Build the complete data structure for MappingReviewPanel.
 */
export function getMappingReviewData(
  db: Database.Database,
  paperId: string,
  workspaceRoot: string,
): MappingReviewData {
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

  const rows = db.prepare(
    'SELECT pcm.*, c.name_en, c.maturity ' +
    'FROM paper_concept_map pcm ' +
    'JOIN concepts c ON c.id = pcm.concept_id ' +
    'WHERE pcm.paper_id = ? ' +
    'ORDER BY pcm.confidence DESC',
  ).all(paperId) as Array<Record<string, unknown>>;

  const decisionPath = path.join(workspaceRoot, 'decisions', `${paperId}.md`);
  const existingDecisions = new Map<string, DecisionEntry>();
  const doc = parseDecisionFile(decisionPath);
  if (doc) {
    for (const entry of doc.entries) {
      existingDecisions.set(entry.conceptId, entry);
    }
  }

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

/**
 * Load rejected mappings for a concept from the database.
 *
 * Fix #15: Rejected mappings are now kept in paper_concept_map with
 * decision_status='rejected' instead of being DELETEd.
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

// ════════════════════════════════════════
// §4 Executor
// ════════════════════════════════════════

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

export interface PostDecisionEffects {
  recomputeRelations?: (paperId: string) => Promise<void>;
  markDraftsStale?: (conceptIds: string[]) => void;
  pushDbChange?: (tables: string[], operation: string) => void;
  triggerAdvisory?: () => Promise<void>;
}

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
    updatePaperMetadata(db, paperId, doc.frontmatter);

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

    if (doc.frontmatter.relevance === 'excluded') {
      handleExcludedPaper(db, paperId, logger);
      excludedCleanup = true;
    }
  });

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
      return executeRejectedEntry(db, paperId, entry, logger);
  }
}

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

  if (entry.changes?.newRelation) {
    setClauses.push('relation = ?');
    params.push(entry.changes.newRelation);
  }

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

// Fix #15: Mark as rejected instead of DELETE
function executeRejectedEntry(
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

function handleExcludedPaper(
  db: Database.Database,
  paperId: string,
  logger?: ExecutorLogger,
): void {
  const timestamp = new Date().toISOString();

  db.prepare(
    "UPDATE paper_concept_map SET reviewed = 1, decision_status = 'excluded', updated_at = ? " +
    "WHERE paper_id = ?",
  ).run(timestamp, paperId);

  db.prepare(
    'DELETE FROM paper_relations WHERE source_paper_id = ? OR target_paper_id = ?',
  ).run(paperId, paperId);

  logger?.info('Paper excluded — mappings marked, relations cleaned', { paperId });
}

function triggerPostDecisionEffects(
  paperId: string,
  doc: DecisionDocument,
  effects?: PostDecisionEffects,
  logger?: ExecutorLogger,
): void {
  const hasRejections = doc.entries.some((e) => e.status === 'rejected');

  // Fix #16: Only recompute relations when relation or confidence changed substantially.
  const hasSubstantialRevisions = doc.entries.some((e) => {
    if (e.status !== 'revised') return false;
    if (e.changes?.newRelation) return true;
    if (e.changes?.newConfidence != null && e.changes?.oldConfidence != null) {
      return Math.abs(e.changes.newConfidence - e.changes.oldConfidence) > 0.05;
    }
    return false;
  });

  if ((hasSubstantialRevisions || hasRejections) && effects?.recomputeRelations) {
    effects.recomputeRelations(paperId).catch((err) =>
      logger?.warn('Post-decision relations recompute failed', {
        paperId, error: (err as Error).message,
      }),
    );
  }

  if ((hasSubstantialRevisions || hasRejections) && effects?.markDraftsStale) {
    const affectedConcepts = doc.entries
      .filter((e) => e.status === 'rejected' || (e.status === 'revised' && (e.changes?.newRelation || (e.changes?.newConfidence != null && e.changes?.oldConfidence != null && Math.abs(e.changes.newConfidence - e.changes.oldConfidence) > 0.05))))
      .map((e) => e.conceptId);
    effects.markDraftsStale(affectedConcepts);
  }

  if (effects?.pushDbChange) {
    effects.pushDbChange(
      ['papers', 'paper_concept_map', 'paper_relations'],
      'update',
    );
  }

  if (effects?.triggerAdvisory) {
    effects.triggerAdvisory().catch((err) =>
      logger?.warn('Post-decision advisory failed', {
        error: (err as Error).message,
      }),
    );
  }
}

// ════════════════════════════════════════
// §5 Writer
// ════════════════════════════════════════

/**
 * Generate a decision Markdown file from structured data.
 * Writes atomically (tmp → rename) to prevent corruption.
 */
export function generateDecisionFile(
  paperId: string,
  frontmatter: DecisionFrontmatter,
  entries: DecisionEntry[],
  workspaceRoot: string,
): string {
  const content = serializeDecisionDocument(paperId, frontmatter, entries);

  const decisionsDir = path.join(workspaceRoot, 'decisions');
  if (!fs.existsSync(decisionsDir)) {
    fs.mkdirSync(decisionsDir, { recursive: true });
  }

  const filePath = path.join(decisionsDir, `${paperId}.md`);

  // Atomic write
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return filePath;
}

/**
 * Update an existing decision file with new entries.
 * Same conceptId entries are overwritten; others are preserved.
 *
 * Fix #14: Optimistic concurrency control via mtime check.
 */
export function updateDecisionFile(
  paperId: string,
  newEntries: DecisionEntry[],
  workspaceRoot: string,
  overrideFrontmatter?: Partial<DecisionFrontmatter>,
  knownMtime?: number,
): string {
  const filePath = path.join(workspaceRoot, 'decisions', `${paperId}.md`);

  // Fix #14: Check for concurrent external modification
  if (knownMtime !== undefined && fs.existsSync(filePath)) {
    const currentMtime = fs.statSync(filePath).mtimeMs;
    if (currentMtime !== knownMtime) {
      throw new Error(
        `Decision file for ${paperId} was modified externally ` +
        `(expected mtime ${knownMtime}, found ${currentMtime}). ` +
        `Please refresh and retry.`,
      );
    }
  }

  const existing = parseDecisionFile(filePath);

  if (existing) {
    const mergedEntries = new Map<string, DecisionEntry>();
    for (const entry of existing.entries) {
      mergedEntries.set(entry.conceptId, entry);
    }
    for (const entry of newEntries) {
      mergedEntries.set(entry.conceptId, entry);
    }

    const frontmatter: DecisionFrontmatter = {
      ...existing.frontmatter,
      date: formatDate(new Date()),
      ...overrideFrontmatter,
    };

    if (existing.researchNotes) {
      frontmatter.researchNotes = existing.researchNotes;
    }

    return generateDecisionFile(
      paperId,
      frontmatter,
      Array.from(mergedEntries.values()),
      workspaceRoot,
    );
  }

  // First decision — create new file
  const frontmatter: DecisionFrontmatter = {
    paperId,
    date: formatDate(new Date()),
    reviewer: 'researcher',
    relevance: 'high',
    decisionNote: null,
    ...overrideFrontmatter,
  };

  return generateDecisionFile(paperId, frontmatter, newEntries, workspaceRoot);
}

// ─── Serialization helpers ───

function serializeDecisionDocument(
  _paperId: string,
  frontmatter: DecisionFrontmatter,
  entries: DecisionEntry[],
): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`paper_id: "${frontmatter.paperId}"`);
  lines.push(`date: "${frontmatter.date}"`);
  lines.push(`reviewer: "${frontmatter.reviewer}"`);
  lines.push(`relevance: "${frontmatter.relevance}"`);
  if (frontmatter.decisionNote) {
    lines.push(`decision_note: "${escapeYaml(frontmatter.decisionNote)}"`);
  }
  lines.push('---');
  lines.push('');

  lines.push('## 概念映射审核');
  lines.push('');

  for (const entry of entries) {
    lines.push(serializeEntry(entry));
    lines.push('');
  }

  lines.push('## 研究笔记');
  lines.push('');
  if (frontmatter.researchNotes) {
    lines.push(frontmatter.researchNotes);
  }

  return lines.join('\n');
}

function serializeEntry(entry: DecisionEntry): string {
  const lines: string[] = [];

  switch (entry.status) {
    case 'accepted': {
      let line = `- [accepted] ${entry.conceptId}`;
      if (entry.relation) {
        line += ` → ${entry.relation}`;
        if (entry.confidence != null) {
          line += ` (confidence: ${entry.confidence})`;
        }
      }
      lines.push(line);
      if (entry.note) lines.push(`  ${entry.note}`);
      break;
    }

    case 'revised': {
      let line = `- [revised] ${entry.conceptId}`;

      if (entry.changes) {
        const c = entry.changes;
        if (c.newRelation && c.oldRelation) {
          line += ` → ${c.newRelation} (原: ${c.oldRelation}`;
          if (c.oldConfidence != null && c.newConfidence != null) {
            line += `, confidence: ${c.oldConfidence} → ${c.newConfidence}`;
          }
          line += ')';
        } else if (c.newConfidence != null && c.oldConfidence != null) {
          line += ` (confidence: ${c.oldConfidence} → ${c.newConfidence})`;
        }
      }

      lines.push(line);

      if (entry.evidence?.en) {
        lines.push(`  EN: "${entry.evidence.en}"`);
      }
      if (entry.evidence?.original && entry.evidence?.originalLang) {
        lines.push(`  原文[${entry.evidence.originalLang}]: "${entry.evidence.original}"`);
      }
      if (entry.reason) {
        lines.push(`  修正理由：${entry.reason}`);
      }
      break;
    }

    case 'rejected': {
      let line = `- [rejected] ${entry.conceptId}`;
      if (entry.originalRelation) {
        line += ` (原: ${entry.originalRelation}`;
        if (entry.originalConfidence != null) {
          line += `, confidence: ${entry.originalConfidence}`;
        }
        line += ')';
      }
      lines.push(line);
      if (entry.reason) {
        lines.push(`  拒绝理由：${entry.reason}`);
      }
      break;
    }
  }

  return lines.join('\n');
}

// ─── Shared helpers ───

function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function detectPaperLanguage(text: string): string {
  if (!text) return 'en';
  const cjkRatio = (text.match(/[\u4e00-\u9fff]/g) ?? []).length / text.length;
  if (cjkRatio > 0.3) return 'zh-CN';
  return 'en';
}
