/**
 * suggested_new_concepts parsing and normalization.
 *
 * Handles:
 * - Field extraction from raw LLM output
 * - Term normalization (trim, lowercase)
 * - Per-paper deduplication
 * - Zero-concept mode enhanced fields (suggested_definition, suggested_keywords)
 *
 * See spec: §9.3
 */

// ─── Types ───

export interface RawSuggestion {
  term?: unknown;
  frequency_in_paper?: unknown;
  frequency?: unknown;
  closest_existing?: unknown;
  reason?: unknown;
  suggested_definition?: unknown;
  suggested_keywords?: unknown;
  [key: string]: unknown;
}

export interface NormalizedSuggestion {
  term: string;
  termNormalized: string;
  frequencyInPaper: number;
  closestExisting: string | null;
  reason: string;
  suggestedDefinition: string | null;
  suggestedKeywords: string[] | null;
}

// ─── Main parser (§9.3) ───

/**
 * Parse and normalize suggested_new_concepts from frontmatter.
 *
 * - Skips entries without valid term strings
 * - Deduplicates by normalized term (case-insensitive, trimmed)
 * - Preserves zero-concept mode extra fields (suggested_definition, suggested_keywords)
 */
export function parseSuggestedConcepts(suggestions: unknown): NormalizedSuggestion[] {
  if (!Array.isArray(suggestions)) return [];

  const parsed: NormalizedSuggestion[] = [];
  const seen = new Set<string>();

  for (const raw of suggestions) {
    if (raw == null || typeof raw !== 'object') continue;

    const s = raw as RawSuggestion;

    // term: required, must be non-empty string
    if (!s.term || typeof s.term !== 'string') continue;
    const term = (s.term as string).trim();
    if (term.length === 0) continue;

    const termNormalized = term.toLowerCase();

    // Deduplicate within same parse batch
    if (seen.has(termNormalized)) continue;
    seen.add(termNormalized);

    const normalized: NormalizedSuggestion = {
      term,
      termNormalized,
      frequencyInPaper: toPositiveInt(s.frequency_in_paper ?? s.frequency, 1),
      closestExisting: toStringOrNull(s.closest_existing),
      reason: typeof s.reason === 'string' ? s.reason : '',
      suggestedDefinition: toStringOrNull(s.suggested_definition),
      suggestedKeywords: toStringArray(s.suggested_keywords),
    };

    parsed.push(normalized);
  }

  return parsed;
}

// ─── Helpers ───

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return fallback;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return filtered.length > 0 ? filtered : null;
}
