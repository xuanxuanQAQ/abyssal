/**
 * Citation Validator — [@paper_id] validity checking against known paper IDs.
 *
 * Scans text for [@hexid] patterns, checks each against a known set,
 * marks invalid citations with ⚠️ warning.
 *
 * See spec: §2.5.1
 */

// ─── Types ───

export interface CitationValidationResult {
  text: string;
  validCount: number;
  invalidCount: number;
  validIds: string[];
  invalidIds: string[];
}

// ─── Citation pattern ───

const CITATION_PATTERN = /\[@([a-f0-9]{12})\]/g;

/**
 * Validate all [@paper_id] citations in text against known paper IDs.
 *
 * Invalid citations are replaced with [⚠️ Unknown: @{id}].
 * Returns the modified text and validation counts.
 */
export function validateCitations(
  text: string,
  knownPaperIds: Set<string>,
): CitationValidationResult {
  const validIds: string[] = [];
  const invalidIds: string[] = [];

  // Collect valid/invalid
  let match: RegExpExecArray | null;
  const regex = new RegExp(CITATION_PATTERN.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const paperId = match[1]!;
    if (knownPaperIds.has(paperId)) {
      validIds.push(paperId);
    } else {
      invalidIds.push(paperId);
    }
  }

  // Replace invalid citations (reverse order to avoid index shift)
  let resultText = text;
  if (invalidIds.length > 0) {
    const invalidSet = new Set(invalidIds);
    resultText = text.replace(CITATION_PATTERN, (fullMatch, paperId: string) => {
      if (invalidSet.has(paperId)) {
        return `[⚠️ Unknown: @${paperId}]`;
      }
      return fullMatch;
    });
  }

  return {
    text: resultText,
    validCount: validIds.length,
    invalidCount: invalidIds.length,
    validIds: [...new Set(validIds)],
    invalidIds: [...new Set(invalidIds)],
  };
}

/**
 * Extract all unique paper IDs referenced as [@paper_id] in text.
 */
export function extractCitedPaperIds(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(CITATION_PATTERN.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1]!);
  }
  return [...ids];
}
