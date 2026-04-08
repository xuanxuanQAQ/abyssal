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

export interface SuggestionParseContext {
  /** All known concept IDs — for resolveClosestExisting fuzzy matching */
  knownConceptIds?: Set<string> | undefined;
  /** Concept name lookup — for name-based fuzzy matching */
  getConceptName?: ((id: string) => string | null) | undefined;
}

export interface RawSuggestion {
  term?: unknown;
  frequency_in_paper?: unknown;
  frequency?: unknown;
  closest_existing?: unknown;
  reason?: unknown;
  suggested_definition?: unknown;
  definition?: unknown;
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
/**
 * Parse and normalize suggested_new_concepts from frontmatter.
 *
 * @param suggestions - Raw array from frontmatter
 * @param context - Optional context for closest_existing fuzzy matching
 */
export function parseSuggestedConcepts(
  suggestions: unknown,
  context?: SuggestionParseContext,
): NormalizedSuggestion[] {
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

    // §10.1: Resolve closest_existing with fuzzy matching
    const closestRaw = toStringOrNull(s.closest_existing);
    const closestExisting = resolveClosestExisting(closestRaw, context);

    // §10.1: suggested_definition from either field name
    const suggestedDef = toStringOrNull(s.suggested_definition) ?? toStringOrNull(s.definition);

    // §10.1: suggested_keywords — handle comma-separated string
    let suggestedKeywords = toStringArray(s.suggested_keywords);
    if (!suggestedKeywords && typeof s.suggested_keywords === 'string') {
      const parts = (s.suggested_keywords as string)
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter((k: string) => k.length > 0);
      suggestedKeywords = parts.length > 0 ? parts.slice(0, 10) : null;
    }

    const normalized: NormalizedSuggestion = {
      term,
      termNormalized,
      frequencyInPaper: clampInt(s.frequency_in_paper ?? s.frequency, 1, 9999),
      closestExisting,
      reason: truncateString(typeof s.reason === 'string' ? s.reason : '', 500),
      suggestedDefinition: suggestedDef ? truncateString(suggestedDef, 500) : null,
      suggestedKeywords,
    };

    parsed.push(normalized);
  }

  return parsed;
}

// ─── Helpers ───

// ─── §10.1: Resolve closest_existing with fuzzy matching ───

function resolveClosestExisting(
  closestField: string | null,
  context?: SuggestionParseContext,
): string | null {
  if (!closestField || !context?.knownConceptIds) return closestField;

  // Exact ID match
  if (context.knownConceptIds.has(closestField)) return closestField;

  // Name-based fuzzy match
  if (context.getConceptName) {
    for (const id of context.knownConceptIds) {
      const name = context.getConceptName(id);
      if (name && name.toLowerCase() === closestField.toLowerCase()) {
        return id;
      }
    }
  }

  // No match found — preserve the original string so downstream consumers
  // (and the researcher) can still see what the LLM considered similar.
  return closestField;
}

// ─── Helpers ───

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value === 'number') {
    const n = Math.floor(value);
    return Math.max(min, Math.min(max, isNaN(n) ? min : n));
  }
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    if (!isNaN(n)) return Math.max(min, Math.min(max, n));
  }
  return min;
}

function truncateString(str: string, maxLen: number): string {
  if (typeof str !== 'string') return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase())
    .slice(0, 10); // §10.1: max 10 keywords
  return filtered.length > 0 ? filtered : null;
}
