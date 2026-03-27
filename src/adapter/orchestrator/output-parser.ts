/**
 * Output Parser — compatibility layer delegating to the new output-parser module.
 *
 * This file preserves the existing public API so that current consumers
 * (analyze.ts, orchestrator/index.ts) continue to work without changes.
 *
 * New code should import from '../output-parser/output-parser' directly.
 *
 * See spec: §7 — Output Parser
 */

// Re-export everything from the new module
export {
  parse as parseOutput,
  parseAndValidate,
  buildParseDiagnostic,
  type ParsedOutput,
  type ValidatedOutput,
  type ParseStrategy,
  type ParseContext,
} from '../output-parser/output-parser';

export {
  type ValidatedMapping as ConceptMapping,
  type BilingualEvidence,
  type ConceptLookup,
} from '../output-parser/field-validator';

export {
  type NormalizedSuggestion as SuggestedNewConcept,
} from '../output-parser/suggestion-parser';

// ─── Legacy extractors for backward compatibility ───

import { validateConceptMappings } from '../output-parser/field-validator';
import { parseSuggestedConcepts } from '../output-parser/suggestion-parser';

/**
 * Extract concept_mappings from parsed frontmatter (legacy API).
 */
export function extractConceptMappings(
  frontmatter: Record<string, unknown> | null,
): Array<{ concept_id: string; relation: string; confidence: number; evidence?: string }> {
  if (!frontmatter) return [];
  const raw = frontmatter['concept_mappings'];
  if (!Array.isArray(raw)) return [];

  const { mappings } = validateConceptMappings(raw);
  return mappings.map((m) => {
    const entry: { concept_id: string; relation: string; confidence: number; evidence?: string } = {
      concept_id: m.concept_id,
      relation: m.relation,
      confidence: m.confidence,
    };
    if (m.evidence.en) entry.evidence = m.evidence.en;
    return entry;
  });
}

/**
 * Extract suggested_new_concepts from parsed frontmatter (legacy API).
 */
export function extractSuggestedConcepts(
  frontmatter: Record<string, unknown> | null,
): Array<{
  term: string;
  frequency_in_paper?: number;
  closest_existing?: string | null;
  reason?: string;
  suggested_definition?: string | null;
  suggested_keywords?: string[] | null;
}> {
  if (!frontmatter) return [];
  const raw = frontmatter['suggested_new_concepts'];
  const parsed = parseSuggestedConcepts(raw);
  return parsed.map((s) => ({
    term: s.term,
    frequency_in_paper: s.frequencyInPaper,
    closest_existing: s.closestExisting,
    reason: s.reason,
    suggested_definition: s.suggestedDefinition,
    suggested_keywords: s.suggestedKeywords,
  }));
}
