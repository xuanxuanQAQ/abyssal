/**
 * Edit Tracker — manages editedParagraphs index sets across draft versions.
 *
 * Handles:
 * - Merging newly detected edits with existing tracked indices
 * - Resetting indices on new AI-generated version
 * - Re-adding restored paragraph indices after protection verification
 * - Tracking paragraph source origin (human_edited vs human_original)
 *
 * See spec: §4.3, §4.6
 */

import { detectEditedParagraphs } from './paragraph-differ';

// ─── Types ───

export type ParagraphOrigin = 'human_edited' | 'human_original' | 'ai_generated';

export interface EditTrackerState {
  /** Indices of paragraphs that are human-edited/authored (0-based) */
  editedParagraphs: number[];
  /** Optional: per-paragraph source tracking (memo:id, note:id, etc.) */
  paragraphSources: Record<number, string>;
}

// ─── Merge edits (§4.3) ───

/**
 * Detect edits between old and new content, merge with existing tracked indices.
 *
 * Called when researcher saves content in Tiptap editor (blur / Ctrl+S).
 */
export function updateEditedParagraphs(
  oldContent: string,
  newContent: string,
  existingEdited: number[],
): number[] {
  const newEdits = detectEditedParagraphs(oldContent, newContent);
  const merged = new Set<number>([...existingEdited, ...newEdits]);

  // Sort ascending
  return [...merged].sort((a, b) => a - b);
}

/**
 * Reset edited paragraphs for a new AI-generated version.
 *
 * After AI rewrites a section, ALL paragraphs are AI-generated,
 * so editedParagraphs resets to empty.
 *
 * Exception: if protection verifier force-restored some paragraphs,
 * those indices are passed back in.
 */
export function resetForNewVersion(
  restoredIndices?: number[],
): number[] {
  return restoredIndices ? [...restoredIndices].sort((a, b) => a - b) : [];
}

/**
 * Add a paragraph index as human_original (from memo/note drag-drop).
 *
 * @param currentEdited - Current edited paragraph indices
 * @param paragraphIndex - Index of the newly inserted paragraph
 * @param sourceRef - Optional source reference (e.g., "memo:abc123" or "note:def456")
 */
export function addHumanOriginal(
  currentEdited: number[],
  paragraphIndex: number,
  sourceRef?: string,
): { editedParagraphs: number[]; paragraphSources: Record<number, string> } {
  const updated = new Set(currentEdited);
  updated.add(paragraphIndex);

  const sources: Record<number, string> = {};
  if (sourceRef) {
    sources[paragraphIndex] = sourceRef;
  }

  return {
    editedParagraphs: [...updated].sort((a, b) => a - b),
    paragraphSources: sources,
  };
}

/**
 * Shift paragraph indices when content is inserted/deleted above tracked positions.
 *
 * @param editedParagraphs - Current indices
 * @param insertedAt - Position where new paragraph was inserted
 * @param delta - Number of paragraphs inserted (+) or removed (-)
 */
export function shiftIndices(
  editedParagraphs: number[],
  insertedAt: number,
  delta: number,
): number[] {
  return editedParagraphs
    .map((idx) => (idx >= insertedAt ? idx + delta : idx))
    .filter((idx) => idx >= 0);
}
