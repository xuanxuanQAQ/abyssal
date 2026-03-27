/**
 * Protection Verifier — post-LLM validation that protected paragraphs survived.
 *
 * After AI generates a revised section, verifies that all paragraphs marked
 * as human-edited appear verbatim in the output. If any are missing,
 * force-restores them at their approximate original positions.
 *
 * See spec: §4.5
 */

import { splitIntoParagraphs } from './paragraph-differ';

// ─── Types ───

export interface ProtectedParagraph {
  index: number;
  content: string;
}

export interface ProtectionViolation {
  originalIndex: number;
  protectedContent: string;
}

export interface VerificationResult {
  content: string;
  restored: boolean;
  violations: ProtectionViolation[];
}

// ─── Verify protection (§4.5) ───

/**
 * Verify that all protected paragraphs appear in the new content.
 * If any are missing, force-restore them and return violation details.
 *
 * @param newContent - AI-generated new version
 * @param protectedParagraphs - Paragraphs that must be preserved verbatim
 * @returns Verified content (potentially with restored paragraphs) + violation info
 */
export function verifyProtection(
  newContent: string,
  protectedParagraphs: ProtectedParagraph[],
): VerificationResult {
  if (protectedParagraphs.length === 0) {
    return { content: newContent, restored: false, violations: [] };
  }

  const newParas = splitIntoParagraphs(newContent);
  const violations: ProtectionViolation[] = [];

  for (const pp of protectedParagraphs) {
    const normalizedProtected = normalize(pp.content);
    let found = false;

    for (const newPara of newParas) {
      const normalizedNew = normalize(newPara);
      if (normalizedNew === normalizedProtected) {
        found = true;
        break;
      }
      // Allow minimal whitespace/punctuation differences (< 2% edit ratio)
      if (editRatio(normalizedNew, normalizedProtected) < 0.02) {
        found = true;
        break;
      }
    }

    if (!found) {
      violations.push({
        originalIndex: pp.index,
        protectedContent: pp.content.slice(0, 100) + (pp.content.length > 100 ? '...' : ''),
      });
    }
  }

  if (violations.length === 0) {
    return { content: newContent, restored: false, violations: [] };
  }

  // Force restore missing protected paragraphs
  const restoredContent = forceRestoreProtectedParagraphs(newContent, protectedParagraphs);
  return { content: restoredContent, restored: true, violations };
}

// ─── Force restore (§4.5) ───

/**
 * Insert missing protected paragraphs back into the content
 * at positions closest to their original indices.
 */
function forceRestoreProtectedParagraphs(
  newContent: string,
  protectedParagraphs: ProtectedParagraph[],
): string {
  const newParas = splitIntoParagraphs(newContent);

  // Sort by index descending to avoid index shift during insertion
  const sorted = [...protectedParagraphs].sort((a, b) => b.index - a.index);

  for (const pp of sorted) {
    const normalizedProtected = normalize(pp.content);
    const insertAt = Math.min(pp.index, newParas.length);

    // Check if the paragraph at this position is already the protected one
    if (insertAt < newParas.length) {
      const ratio = editRatio(normalize(newParas[insertAt]!), normalizedProtected);
      if (ratio < 0.05) continue; // Already present at correct position
    }

    // Check if it exists anywhere (position shifted)
    let foundElsewhere = false;
    for (const para of newParas) {
      if (editRatio(normalize(para), normalizedProtected) < 0.02) {
        foundElsewhere = true;
        break;
      }
    }

    if (!foundElsewhere) {
      newParas.splice(insertAt, 0, pp.content);
    }
  }

  return newParas.join('\n\n');
}

// ─── Build protection instruction block (§4.4) ───

/**
 * Build the protection instruction block for the LLM prompt.
 *
 * @param currentContent - Current section content
 * @param editedIndices - Indices of human-edited paragraphs
 * @returns Protection block for system prompt + protected paragraphs list
 */
export function buildProtectionBlock(
  currentContent: string,
  editedIndices: number[],
): { protectionBlock: string; protectedParagraphs: ProtectedParagraph[] } {
  if (editedIndices.length === 0) {
    return { protectionBlock: '', protectedParagraphs: [] };
  }

  const paragraphs = splitIntoParagraphs(currentContent);
  const protectedParagraphs: ProtectedParagraph[] = [];

  for (const index of editedIndices) {
    if (index >= 0 && index < paragraphs.length) {
      protectedParagraphs.push({ index, content: paragraphs[index]! });
    }
  }

  if (protectedParagraphs.length === 0) {
    return { protectionBlock: '', protectedParagraphs: [] };
  }

  let block = '## ⚠️ Protected Paragraphs\n\n';
  block += 'The following paragraphs were manually edited or authored by the researcher. ';
  block += 'You MUST preserve them EXACTLY as-is in your output. ';
  block += 'Do not modify, rephrase, or rewrite any of them.\n\n';

  for (const pp of protectedParagraphs) {
    block += `### Protected Paragraph ${pp.index + 1}\n`;
    block += '```\n';
    block += pp.content + '\n';
    block += '```\n\n';
  }

  block += 'You may adjust surrounding (unprotected) text to maintain ';
  block += 'flow and coherence, but protected paragraphs must appear ';
  block += 'verbatim in your output at approximately the same position.\n';

  return { protectionBlock: block, protectedParagraphs };
}

// ─── Helpers ───

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Compute edit ratio using single-row Levenshtein distance.
 * Unlike positional comparison, this handles insertions/deletions correctly —
 * a paragraph shifted by one character insertion won't falsely fail verification.
 */
function editRatio(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  // For very long strings (>2000 chars), use character frequency approximation
  if (maxLen > 2000) {
    let diff = 0;
    const freqA = new Map<string, number>();
    const freqB = new Map<string, number>();
    for (const ch of a) freqA.set(ch, (freqA.get(ch) ?? 0) + 1);
    for (const ch of b) freqB.set(ch, (freqB.get(ch) ?? 0) + 1);
    const allChars = new Set([...freqA.keys(), ...freqB.keys()]);
    for (const ch of allChars) diff += Math.abs((freqA.get(ch) ?? 0) - (freqB.get(ch) ?? 0));
    return diff / maxLen;
  }
  // Single-row Levenshtein
  let short = a, long = b;
  if (short.length > long.length) [short, long] = [long, short];
  const row = new Array<number>(short.length + 1);
  for (let i = 0; i <= short.length; i++) row[i] = i;
  for (let j = 1; j <= long.length; j++) {
    let prev = row[0]!;
    row[0] = j;
    for (let i = 1; i <= short.length; i++) {
      const temp = row[i]!;
      row[i] = Math.min(row[i]! + 1, row[i - 1]! + 1, prev + (short[i - 1] === long[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[short.length]! / maxLen;
}
