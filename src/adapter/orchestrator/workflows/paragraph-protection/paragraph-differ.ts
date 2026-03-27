/**
 * Paragraph Differ — paragraph-level diff detection for edit tracking.
 *
 * Splits content into paragraphs, aligns old↔new using normalized
 * content matching, and identifies inserted/modified paragraphs.
 *
 * editRatio threshold: < 0.1 = typo fix (not an edit), ≥ 0.1 = substantive edit.
 *
 * See spec: §4.2
 */

// ─── Types ───

export type ParagraphStatus = 'unchanged' | 'modified' | 'inserted' | 'deleted';

export interface ParagraphAlignment {
  newIndex: number;
  oldIndex: number | null;
  status: ParagraphStatus;
}

// ─── Split into paragraphs ───

/**
 * Split content into paragraphs by double newlines.
 */
export function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ─── Detect edited paragraphs (§4.2) ───

/**
 * Compare old and new content, returning indices of paragraphs
 * that were substantively modified or newly inserted.
 *
 * Returns a Set of 0-based paragraph indices in the NEW content.
 */
export function detectEditedParagraphs(
  oldContent: string,
  newContent: string,
): Set<number> {
  const oldParas = splitIntoParagraphs(oldContent);
  const newParas = splitIntoParagraphs(newContent);

  const alignment = alignParagraphs(oldParas, newParas);
  const editedIndices = new Set<number>();

  for (const entry of alignment) {
    if (entry.status === 'modified' || entry.status === 'inserted') {
      editedIndices.add(entry.newIndex);
    }
  }

  return editedIndices;
}

// ─── Paragraph alignment (simplified LCS) ───

/**
 * Align old and new paragraph arrays using normalized content matching.
 *
 * Strategy:
 * 1. Build old paragraph → index map (normalized)
 * 2. For each new paragraph, find exact or near-exact match in old
 * 3. Unmatched new paragraphs → 'inserted' or 'modified'
 */
export function alignParagraphs(
  oldParas: string[],
  newParas: string[],
): ParagraphAlignment[] {
  const result: ParagraphAlignment[] = [];
  const oldMap = new Map<string, number>();

  for (let i = 0; i < oldParas.length; i++) {
    const normalized = normalize(oldParas[i]!);
    if (!oldMap.has(normalized)) {
      oldMap.set(normalized, i);
    }
  }

  const usedOldIndices = new Set<number>();

  for (let newIdx = 0; newIdx < newParas.length; newIdx++) {
    const normalizedNew = normalize(newParas[newIdx]!);

    // Exact match
    if (oldMap.has(normalizedNew)) {
      const oldIdx = oldMap.get(normalizedNew)!;
      if (!usedOldIndices.has(oldIdx)) {
        result.push({ newIndex: newIdx, oldIndex: oldIdx, status: 'unchanged' });
        usedOldIndices.add(oldIdx);
        continue;
      }
    }

    // Near-match: find closest old paragraph by edit ratio
    const bestMatch = findClosestParagraph(newParas[newIdx]!, oldParas, usedOldIndices);

    if (bestMatch && bestMatch.editRatio < 0.1) {
      // Typo fix — not a substantive edit
      result.push({ newIndex: newIdx, oldIndex: bestMatch.index, status: 'unchanged' });
      usedOldIndices.add(bestMatch.index);
    } else if (bestMatch && bestMatch.editRatio < 0.5) {
      // Substantive modification
      result.push({ newIndex: newIdx, oldIndex: bestMatch.index, status: 'modified' });
      usedOldIndices.add(bestMatch.index);
    } else {
      // New insertion
      result.push({ newIndex: newIdx, oldIndex: null, status: 'inserted' });
    }
  }

  return result;
}

// ─── Helpers ───

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface ClosestMatch {
  index: number;
  editRatio: number;
}

function findClosestParagraph(
  target: string,
  candidates: string[],
  usedIndices: Set<number>,
): ClosestMatch | null {
  const normalizedTarget = normalize(target);
  let bestRatio = Infinity;
  let bestIndex = -1;

  for (let i = 0; i < candidates.length; i++) {
    if (usedIndices.has(i)) continue;
    const normalizedCandidate = normalize(candidates[i]!);
    const ratio = computeEditRatio(normalizedTarget, normalizedCandidate);

    if (ratio < bestRatio) {
      bestRatio = ratio;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) return null;
  return { index: bestIndex, editRatio: bestRatio };
}

/**
 * Compute edit ratio = levenshtein(a, b) / max(len(a), len(b)).
 *
 * Uses a memory-efficient single-row Levenshtein implementation
 * suitable for paragraph-length strings (typically 100-500 chars).
 */
function computeEditRatio(a: string, b: string): number {
  if (a === b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;

  // For very long strings, use a faster approximation
  if (maxLen > 2000) {
    // Character-frequency difference as approximation
    return charFrequencyDiff(a, b);
  }

  const distance = levenshteinDistance(a, b);
  return distance / maxLen;
}

/**
 * Single-row Levenshtein distance (O(n*m) time, O(min(n,m)) space).
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a]; // Ensure a is shorter

  const aLen = a.length;
  const bLen = b.length;
  const row = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0]!;
    row[0] = j;

    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const temp = row[i]!;
      row[i] = Math.min(
        row[i]! + 1,      // deletion
        row[i - 1]! + 1,  // insertion
        prev + cost,       // substitution
      );
      prev = temp;
    }
  }

  return row[aLen]!;
}

/**
 * Fast character frequency approximation for very long strings.
 */
function charFrequencyDiff(a: string, b: string): number {
  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();

  for (const ch of a) freqA.set(ch, (freqA.get(ch) ?? 0) + 1);
  for (const ch of b) freqB.set(ch, (freqB.get(ch) ?? 0) + 1);

  let diff = 0;
  const allChars = new Set([...freqA.keys(), ...freqB.keys()]);
  for (const ch of allChars) {
    diff += Math.abs((freqA.get(ch) ?? 0) - (freqB.get(ch) ?? 0));
  }

  return diff / Math.max(a.length, b.length);
}
