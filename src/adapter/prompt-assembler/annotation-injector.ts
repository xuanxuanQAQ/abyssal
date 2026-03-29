/**
 * Annotation Injector — researcher annotation formatting for prompt injection.
 *
 * §3.3: formatAnnotations() — per-annotation formatting with:
 *   - Page number + annotation type
 *   - Selected text (truncated to 300 chars)
 *   - Optional comment
 *   - Optional concept link
 *
 * Annotations are ABSOLUTE priority — never trimmed by CBM.
 */

// ─── Types ───

export interface AnnotationForInjection {
  page?: number;
  type?: string;       // 'highlight' | 'note' | 'conceptTag'
  text: string;        // selectedText
  comment?: string;
  conceptId?: string;
  conceptName?: string;
}

export interface FormattedAnnotations {
  block: string | null;
  tokens: number;
  count: number;
}

interface TokenCounter {
  count: (text: string) => number;
}

// ─── §3.3: Annotation formatting ───

const MAX_TEXT_LENGTH = 300;

/**
 * Format researcher annotations into a prompt-ready block.
 *
 * Format per annotation:
 *   ⭐ [Page {page}] {type}
 *   Text: "{selectedText}" (truncated to 300 chars)
 *   Note: "{comment}"
 *   Concept: {conceptName}
 */
export function formatAnnotations(
  annotations: AnnotationForInjection[],
  tokenCounter: TokenCounter,
): FormattedAnnotations {
  if (annotations.length === 0) {
    return { block: null, tokens: 0, count: 0 };
  }

  const lines: string[] = [];

  for (const ann of annotations) {
    const pageStr = ann.page != null ? `Page ${ann.page}` : 'Page ?';
    const typeStr = ann.type ?? 'highlight';
    let line = `⭐ [${pageStr}] ${typeStr}`;

    // Selected text with truncation
    if (ann.text) {
      const truncated = ann.text.length > MAX_TEXT_LENGTH
        ? ann.text.slice(0, MAX_TEXT_LENGTH) + '...'
        : ann.text;
      line += `\nText: "${truncated}"`;
    }

    // Comment
    if (ann.comment) {
      line += `\nNote: "${ann.comment}"`;
    }

    // Concept link
    if (ann.conceptId) {
      const label = ann.conceptName ?? ann.conceptId;
      line += `\nConcept: ${label}`;
    }

    lines.push(line);
  }

  const block = "## Researcher's Annotations\n\n" + lines.join('\n\n');
  const tokens = tokenCounter.count(block);

  return { block, tokens, count: annotations.length };
}
