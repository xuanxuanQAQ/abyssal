/**
 * Decision Writer — decision file generation and incremental update.
 *
 * §5.1: Triggered when researcher saves decisions from MappingReviewPanel.
 * §5.2: Serializes frontmatter + entries + bilingual evidence into Markdown.
 * §5.3: Incremental update — merges new entries with existing file (same conceptId overwrites).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseDecisionFile,
  type DecisionFrontmatter,
  type DecisionEntry,
} from './decision-parser';

// ─── §5.2: Generate complete decision file ───

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

// ─── §5.3: Incremental update ───

/**
 * Update an existing decision file with new entries.
 * Same conceptId entries are overwritten; others are preserved.
 * If no file exists, creates a new one.
 *
 * Fix #14: Optimistic concurrency control via mtime check.
 * Pass knownMtime (from when UI loaded the file) to detect external modifications.
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
    // Merge entries — new entries overwrite same conceptId
    const mergedEntries = new Map<string, DecisionEntry>();
    for (const entry of existing.entries) {
      mergedEntries.set(entry.conceptId, entry);
    }
    for (const entry of newEntries) {
      mergedEntries.set(entry.conceptId, entry);
    }

    // Update frontmatter date
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

// ─── Serialization ───

function serializeDecisionDocument(
  paperId: string,
  frontmatter: DecisionFrontmatter,
  entries: DecisionEntry[],
): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`paper_id: "${paperId}"`);
  lines.push(`date: "${frontmatter.date}"`);
  lines.push(`reviewer: "${frontmatter.reviewer}"`);
  lines.push(`relevance: "${frontmatter.relevance}"`);
  if (frontmatter.decisionNote) {
    lines.push(`decision_note: "${escapeYaml(frontmatter.decisionNote)}"`);
  }
  lines.push('---');
  lines.push('');

  // Decision entries
  lines.push('## 概念映射审核');
  lines.push('');

  for (const entry of entries) {
    lines.push(serializeEntry(entry));
    lines.push('');
  }

  // Research notes
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

      // Bilingual evidence
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

// ─── Helpers ───

function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
