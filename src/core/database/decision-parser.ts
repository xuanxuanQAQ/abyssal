/**
 * Decision Parser — Markdown decision file AST parser.
 *
 * §2: Parses workspace/decisions/{paper_id}.md into structured DecisionDocument.
 *
 * Three phases:
 *   Phase 1: YAML frontmatter extraction + validation
 *   Phase 2: Decision entry extraction (accepted/revised/rejected)
 *   Phase 3: Research notes extraction
 */

import * as fs from 'node:fs';
import yaml from 'js-yaml';

// ─── Types ───

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

// ─── Error ───

export class DecisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionParseError';
  }
}

// ─── §2.1: Parse entry ───

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

  // Phase 1: Frontmatter
  const frontmatter = extractFrontmatter(content);

  // Phase 2: Decision entries
  const entries = extractDecisionEntries(content, warnings);

  // Phase 3: Research notes
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
  // Locate "概念映射审核" section
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

// §2.4.2: Split into entries by "- [" boundary
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

// §2.4.3: Parse single entry — dispatch by status
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

// §2.4.4: [accepted]
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

// §2.4.5: [revised] — most complex
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
    // Pattern B: relation-only change — → new_relation (原: old_relation)
    const relationOnly = /→\s*(\w+)\s*\(原:\s*(\w+)\)/;
    const relMatch = rawText.match(relationOnly);
    if (relMatch) {
      changes.newRelation = relMatch[1]!;
      changes.oldRelation = relMatch[2]!;
    }

    // Pattern C: confidence-only change — (confidence: old → new)
    const confOnly = /\(confidence:\s*([\d.]+)\s*→\s*([\d.]+)\)/;
    const confMatch = rawText.match(confOnly);
    if (confMatch) {
      changes.oldConfidence = parseFloat(confMatch[1]!);
      changes.newConfidence = parseFloat(confMatch[2]!);
    }
  }

  // Extract bilingual evidence
  const evidence: DecisionEvidence = { en: null, original: null, originalLang: null };

  // Fix #13: Use greedy-to-last-quote to handle embedded quotes in evidence text
  const enPattern = /EN:\s*"([\s\S]*?)"\s*$/m;
  const enMatch = rawText.match(enPattern);
  if (enMatch) evidence.en = enMatch[1]!.replace(/\n\s*/g, ' ').trim();

  const originalPattern = /原文\[([^\]]+)\]:\s*"([\s\S]*?)"\s*$/m;
  const originalMatch = rawText.match(originalPattern);
  if (originalMatch) {
    evidence.originalLang = originalMatch[1]!;
    evidence.original = originalMatch[2]!;
  }

  // Fix #13: Capture multi-line reason (user may press Enter in the middle).
  // Match from "修正理由：" to the next known field label or end of entry.
  const reasonPattern = /修正理由[：:]\s*([\s\S]*?)(?=\n\s*(?:EN:|原文\[|拒绝理由|$))/m;
  const reasonMatch = rawText.match(reasonPattern);
  const reason = reasonMatch?.[1]?.replace(/\n\s*/g, ' ').trim() ?? null;

  // Validation
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

// §2.4.6: [rejected]
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
