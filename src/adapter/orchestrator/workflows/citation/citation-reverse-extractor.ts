/**
 * Citation Reverse Extractor — restores [@paper_id] from dual-preserve format.
 *
 * Converts [[@paper_id]](rendered text) back to [@paper_id].
 * Used when synthesis drafts are consumed by article workflow
 * or when CSL style is changed (re-render cycle).
 *
 * See spec: §2.5.3
 */

// ─── Patterns ───

/** Matches single paper: [[@hexid]](any rendered text) */
const SINGLE_PATTERN = /\[\[@([a-f0-9]{12})\]\]\([^)]+\)/g;

/** Matches cluster: [[@id1;@id2;@id3]](any rendered text) */
const CLUSTER_PATTERN = /\[\[(@[a-f0-9]{12}(?:;@[a-f0-9]{12})*)\]\]\([^)]+\)/g;

// ─── Reverse extraction (§2.5.3) ───

/**
 * Restore [@paper_id] markers from dual-preserve format.
 *
 * [[@abc123def456]](Goffman, 1959) → [@abc123def456]
 * [[@id1;@id2;@id3]](Author1; Author2; Author3) → [@id1][@id2][@id3]
 */
export function reverseExtractCitations(preformattedText: string): string {
  let result = preformattedText;

  // Handle clusters first (multi-id)
  result = result.replace(CLUSTER_PATTERN, (_match, idsPart: string) => {
    const ids = idsPart.split(';').map((id: string) => id.trim());
    return ids.map((id: string) => `[${id}]`).join('');
  });

  // Handle single citations
  result = result.replace(SINGLE_PATTERN, '[@$1]');

  return result;
}

/**
 * Extract all paper IDs from dual-preserve formatted text.
 * Works with both single and cluster formats.
 */
export function extractPaperIdsFromPreformatted(text: string): string[] {
  const ids = new Set<string>();

  // Single citations
  let match: RegExpExecArray | null;
  const singleRegex = new RegExp(SINGLE_PATTERN.source, 'g');
  while ((match = singleRegex.exec(text)) !== null) {
    ids.add(match[1]!);
  }

  // Cluster citations
  const clusterRegex = new RegExp(CLUSTER_PATTERN.source, 'g');
  while ((match = clusterRegex.exec(text)) !== null) {
    const idsPart = match[1]!;
    for (const id of idsPart.split(';')) {
      const trimmed = id.trim().replace(/^@/, '');
      if (trimmed.length === 12) ids.add(trimmed);
    }
  }

  return [...ids];
}
