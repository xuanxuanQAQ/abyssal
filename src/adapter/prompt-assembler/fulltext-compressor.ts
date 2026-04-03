/**
 * Fulltext Compressor — structure-aware text compression for paper fulltext.
 *
 * §6.1: compressFulltext() — deterministic compression driven by SectionMap.
 *
 * Strategy:
 * 1. Abstract 100% preserved (ABSOLUTE)
 * 2. Conclusion preserved (or discussion last subsection as fallback)
 * 3. Remaining budget distributed across body sections by SECTION_WEIGHTS
 * 4. Over-budget sections: first paragraph + last sentence + omission marker
 */

// ─── Types ───

export interface SectionMapEntry {
  sectionType: string;  // 'abstract' | 'introduction' | 'methods' | 'results' | 'discussion' | 'conclusion' | 'references' | ...
  title: string;
  startOffset: number;
  endOffset: number;
}

interface TokenCounter {
  count: (text: string) => number;
}

// ─── Section weight table ───

const SECTION_WEIGHTS: Record<string, number> = {
  introduction: 1.0,
  results: 1.0,
  discussion: 0.9,
  methods: 0.8,
  theory: 0.9,
  literature_review: 0.7,
  body: 0.5,
};

const EXCLUDED_SECTION_TYPES = new Set([
  'references', 'acknowledgments', 'appendix', 'abstract', 'conclusion',
]);

// ─── §6.1: Main compression entry ───

/**
 * Compress paper fulltext to fit within targetTokens using section-aware strategy.
 *
 * @param text - Full paper text
 * @param sectionMap - Parsed section boundaries (from PDF processing)
 * @param targetTokens - Token budget for fulltext
 * @param tokenCounter - Token counting function
 */
export function compressFulltext(
  text: string,
  sectionMap: SectionMapEntry[] | null,
  targetTokens: number,
  tokenCounter: TokenCounter,
): string {
  // If no sectionMap, fall back to simple truncation
  if (!sectionMap || sectionMap.length === 0) {
    return simpleCompress(text, targetTokens, tokenCounter);
  }

  // Extract absolute regions
  const abstract = extractSectionText(text, sectionMap, 'abstract');
  let conclusion = extractSectionText(text, sectionMap, 'conclusion');

  // Fallback: discussion last subsection
  if (!conclusion) {
    conclusion = extractLastSubsection(text, sectionMap, 'discussion');
  }

  const fixedTokens =
    tokenCounter.count(abstract ?? '') + tokenCounter.count(conclusion ?? '');

  // Extreme case: only abstract fits
  if (fixedTokens >= targetTokens) {
    let result = abstract ?? '';
    result += '\n\n<abyssal:omitted section="body" reason="budget" />\n\n';
    if (conclusion) {
      result += extractFirstSentence(conclusion);
    }
    return result;
  }

  // Distributable budget for body sections
  const distributableBudget = targetTokens - fixedTokens;

  // Filter to distributable sections
  const sections = sectionMap.filter((s) => !EXCLUDED_SECTION_TYPES.has(s.sectionType));

  const totalWeight = sections.reduce(
    (sum, s) => sum + (SECTION_WEIGHTS[s.sectionType] ?? 0.5),
    0,
  );

  const compressedSections: string[] = [];

  for (const section of sections) {
    const sectionText = text.slice(section.startOffset, section.endOffset);
    const sectionTokens = tokenCounter.count(sectionText);
    const weight = SECTION_WEIGHTS[section.sectionType] ?? 0.5;
    const allocated = Math.floor((weight / totalWeight) * distributableBudget);

    if (sectionTokens <= allocated) {
      compressedSections.push(sectionText);
    } else {
      compressedSections.push(
        compressSection(sectionText, allocated, section.title, tokenCounter, section.sectionType),
      );
    }
  }

  // Assemble
  let result = '';
  if (abstract) result += abstract + '\n\n';
  result += compressedSections.join('\n\n');
  if (conclusion) result += '\n\n' + conclusion;

  return result;
}

// ─── Section-level compression ───

/** Pattern matching paragraphs containing statistical/quantitative content */
const STAT_PATTERN = /(?:p\s*[<>=]|d\s*=|r\s*=|[βBb]\s*=|η[²2]|F\s*\(|t\s*\(|χ[²2]|N\s*=|n\s*=|OR\s*=|HR\s*=|CI\s*[=:]|R[²2]\s*=|%|significant|p\s*<\s*[.0])/i;

/**
 * Check whether a paragraph contains statistical/quantitative content.
 */
function containsStatisticalContent(paragraph: string): boolean {
  return STAT_PATTERN.test(paragraph);
}

/**
 * Compress a single section using an evidence-aware strategy.
 *
 * For 'results' and 'discussion' sections: preserves first paragraph +
 * all paragraphs containing statistical/quantitative content + last paragraph.
 * This prevents loss of key empirical findings that often appear mid-section.
 *
 * For other sections: first paragraph + last sentence + omission marker.
 */
function compressSection(
  sectionText: string,
  targetTokens: number,
  sectionTitle: string,
  tokenCounter: TokenCounter,
  sectionType?: string,
): string {
  const paragraphs = sectionText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  if (paragraphs.length <= 2) {
    return truncateToTokens(sectionText, targetTokens, tokenCounter);
  }

  // For results/discussion: use evidence-aware compression
  const isEvidenceSection = sectionType === 'results' || sectionType === 'discussion';
  if (isEvidenceSection) {
    return compressSectionWithStatRetention(paragraphs, targetTokens, sectionTitle, tokenCounter);
  }

  const firstParagraph = paragraphs[0]!;
  const lastParagraph = paragraphs[paragraphs.length - 1]!;
  const lastFirstSentence = extractFirstSentence(lastParagraph);

  const omittedCount = paragraphs.length - 2;
  const omittedText = paragraphs.slice(1, -1).join('\n\n');
  const omittedTokens = tokenCounter.count(omittedText);

  // Fix #7: Use XML tags instead of natural-language markers to prevent language drift
  let compressed =
    firstParagraph +
    `\n\n<abyssal:omitted paragraphs="${omittedCount}" tokens="${omittedTokens}" section="${sectionTitle}" />\n\n` +
    lastFirstSentence;

  // If first paragraph itself exceeds target
  if (tokenCounter.count(compressed) > targetTokens) {
    compressed =
      truncateToTokens(firstParagraph, targetTokens - 50, tokenCounter) +
      `\n<abyssal:omitted section="${sectionTitle}" reason="budget" />`;
  }

  return compressed;
}

/**
 * Evidence-aware compression: keep first + statistical paragraphs + last.
 * Falls back to standard compression if stat paragraphs exceed budget.
 */
function compressSectionWithStatRetention(
  paragraphs: string[],
  targetTokens: number,
  sectionTitle: string,
  tokenCounter: TokenCounter,
): string {
  const first = paragraphs[0]!;
  const last = paragraphs[paragraphs.length - 1]!;
  const middle = paragraphs.slice(1, -1);

  // Identify statistical paragraphs in the middle
  const statParagraphs = middle.filter(containsStatisticalContent);
  const nonStatCount = middle.length - statParagraphs.length;

  // Build candidate: first + stat paragraphs + last
  const candidate = [first, ...statParagraphs, last].join('\n\n');
  const candidateTokens = tokenCounter.count(candidate);

  if (candidateTokens <= targetTokens) {
    // Fits — add omission marker for non-stat paragraphs
    if (nonStatCount > 0) {
      const parts = [first];
      let insertedOmission = false;
      for (const p of middle) {
        if (containsStatisticalContent(p)) {
          if (!insertedOmission && nonStatCount > 0) {
            parts.push(`<abyssal:omitted paragraphs="${nonStatCount}" section="${sectionTitle}" reason="non-quantitative" />`);
            insertedOmission = true;
          }
          parts.push(p);
        }
      }
      if (!insertedOmission) {
        parts.push(`<abyssal:omitted paragraphs="${nonStatCount}" section="${sectionTitle}" reason="non-quantitative" />`);
      }
      parts.push(last);
      return parts.join('\n\n');
    }
    return candidate;
  }

  // Stat paragraphs exceed budget — fall back to first + last + truncated stats
  const firstLast = first + '\n\n' + extractFirstSentence(last);
  const remaining = targetTokens - tokenCounter.count(firstLast) - 20;
  if (remaining > 0 && statParagraphs.length > 0) {
    const truncatedStats = truncateToTokens(
      statParagraphs.join('\n\n'),
      remaining,
      tokenCounter,
    );
    return first +
      '\n\n' + truncatedStats +
      `\n\n<abyssal:omitted section="${sectionTitle}" reason="budget" />\n\n` +
      extractFirstSentence(last);
  }

  return truncateToTokens(first, targetTokens - 50, tokenCounter) +
    `\n<abyssal:omitted section="${sectionTitle}" reason="budget" />`;
}

// ─── Helpers ───

function extractSectionText(
  text: string,
  sectionMap: SectionMapEntry[],
  sectionType: string,
): string | null {
  const section = sectionMap.find((s) => s.sectionType === sectionType);
  if (!section) return null;
  const extracted = text.slice(section.startOffset, section.endOffset).trim();
  return extracted.length > 0 ? extracted : null;
}

function extractLastSubsection(
  text: string,
  sectionMap: SectionMapEntry[],
  sectionType: string,
): string | null {
  const section = sectionMap.find((s) => s.sectionType === sectionType);
  if (!section) return null;
  const sectionText = text.slice(section.startOffset, section.endOffset);
  const paragraphs = sectionText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1]! : null;
}

export function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]/);
  return match ? match[0] : text.slice(0, 200);
}

function truncateToTokens(text: string, targetTokens: number, tokenCounter: TokenCounter): string {
  let current = text;
  while (tokenCounter.count(current) > targetTokens && current.length > 100) {
    // Remove ~20% from the end each iteration
    const cutPoint = Math.floor(current.length * 0.8);
    current = current.slice(0, cutPoint);
  }
  return current;
}

/**
 * Simple compression fallback when no sectionMap is available.
 * Keeps the beginning of the text up to the token budget.
 */
function simpleCompress(text: string, targetTokens: number, tokenCounter: TokenCounter): string {
  if (tokenCounter.count(text) <= targetTokens) return text;

  // Estimate character ratio
  const totalTokens = tokenCounter.count(text);
  const ratio = targetTokens / totalTokens;
  const cutPoint = Math.floor(text.length * ratio * 0.95); // slight undercut for safety

  const truncated = text.slice(0, cutPoint);
  return truncated + '\n\n<abyssal:omitted reason="budget" />';
}
