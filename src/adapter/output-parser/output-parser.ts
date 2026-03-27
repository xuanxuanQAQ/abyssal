/**
 * Output Parser — five-level fallback parsing chain for LLM output.
 *
 * Level 1: Standard YAML fence (---\n...\n---) with prefix tolerance
 * Level 2: Code-block wrapped YAML (```yaml\n...\n```)
 * Level 3: JSON fallback (```json or bare JSON)
 * Level 4: Regex field extraction (concept_id/relation/confidence patterns)
 * Level 5: Failed — preserve raw output for diagnosis
 *
 * Each level attempts auto-repair (§8) before giving up.
 * Successful parse results pass through field validation (§9).
 *
 * See spec: §7
 */

import yaml from 'js-yaml';
import { jsonrepair } from 'jsonrepair';
import { applyRepairRules } from './auto-repair';
import { validateConceptMappings, type ConceptLookup, type ValidatedMapping } from './field-validator';
import { parseSuggestedConcepts, type NormalizedSuggestion } from './suggestion-parser';

// ─── Types ───

export type ParseStrategy =
  | 'yaml_fence'
  | 'yaml_fence_repaired'
  | 'code_block'
  | 'code_block_repaired'
  | 'json_fallback'
  | 'json_repaired'
  | 'regex_extraction'
  | 'parse_failed';

export interface ParsedOutput {
  success: boolean;
  frontmatter: Record<string, unknown> | null;
  body: string;
  strategy: ParseStrategy;
  repairRules?: string[];
}

export interface ValidatedOutput {
  success: boolean;
  frontmatter: Record<string, unknown> | null;
  body: string;
  strategy: ParseStrategy;
  repairRules: string[];
  conceptMappings: ValidatedMapping[];
  suggestedConcepts: NormalizedSuggestion[];
  warnings: string[];
}

export interface ParseContext {
  paperId: string;
  model?: string;
  conceptLookup?: ConceptLookup;
}

// ─── Logger interface ───

interface ParserLogger {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  debug?: (msg: string, ctx?: Record<string, unknown>) => void;
}

// ─── Main parse + validate pipeline (§7.1) ───

/**
 * Parse LLM output through five-level fallback chain, then validate fields.
 */
export function parseAndValidate(
  llmOutput: string,
  context: ParseContext,
  logger?: ParserLogger,
): ValidatedOutput {
  const parsed = parse(llmOutput);

  if (!parsed.success || !parsed.frontmatter) {
    logger?.warn('Output parse failed', {
      paperId: context.paperId,
      outputLength: llmOutput.length,
      hasTripleDash: llmOutput.includes('---'),
      hasYamlKeywords: /concept_mappings|concept_id|relation|confidence/.test(llmOutput),
      firstChars: llmOutput.slice(0, 500),
      model: context.model,
      strategy: 'parse_failed',
    });

    return {
      success: false,
      frontmatter: null,
      body: llmOutput,
      strategy: 'parse_failed',
      repairRules: [],
      conceptMappings: [],
      suggestedConcepts: [],
      warnings: ['All parse strategies failed'],
    };
  }

  // Field validation (§9)
  const rawMappings = parsed.frontmatter['concept_mappings'];
  const mappingResult = validateConceptMappings(
    Array.isArray(rawMappings) ? rawMappings : [],
    context.conceptLookup,
  );

  const rawSuggestions = parsed.frontmatter['suggested_new_concepts'];
  let suggestions = parseSuggestedConcepts(rawSuggestions);

  // Merge diverted unknown concept_ids into suggestions.
  // Unknown IDs are stripped from mappings to prevent FK constraint violations,
  // and re-surfaced as suggested_new_concepts for human review.
  if (mappingResult.divertedToSuggestions.length > 0) {
    const divertedSuggestions: NormalizedSuggestion[] = mappingResult.divertedToSuggestions.map((d) => ({
      term: d.concept_id,
      termNormalized: d.concept_id.toLowerCase(),
      frequencyInPaper: 1,
      closestExisting: null,
      reason: `Diverted from concept_mappings: LLM referenced unknown concept_id "${d.concept_id}" (relation: ${d.relation}, confidence: ${d.confidence}). Evidence: ${d.evidence.en || '(none)'}`,
      suggestedDefinition: null,
      suggestedKeywords: null,
    }));
    // Append only if not already present (avoid duplicates by normalized term)
    const existingTerms = new Set(suggestions.map((s) => s.termNormalized));
    for (const ds of divertedSuggestions) {
      if (!existingTerms.has(ds.termNormalized)) {
        suggestions.push(ds);
        existingTerms.add(ds.termNormalized);
      }
    }
  }

  // §12.2: Parse completion log
  logger?.debug?.('Parse completed', {
    paperId: context.paperId,
    strategy: parsed.strategy,
    repairRules: parsed.repairRules ?? [],
    conceptMappings: mappingResult.mappings.length,
    divertedToSuggestions: mappingResult.divertedToSuggestions.length,
    suggestedConcepts: suggestions.length,
    warnings: mappingResult.warnings,
    model: context.model,
  });

  return {
    success: true,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    strategy: parsed.strategy,
    repairRules: parsed.repairRules ?? [],
    conceptMappings: mappingResult.mappings,
    suggestedConcepts: suggestions,
    warnings: mappingResult.warnings,
  };
}

// ─── Five-level fallback chain ───

/**
 * Parse LLM output using five-level fallback chain (§7).
 */
export function parse(llmOutput: string): ParsedOutput {
  // Level 1: Standard YAML fence (§7.2)
  const l1 = tryYamlFence(llmOutput);
  if (l1) return l1;

  // Level 2: Code-block wrapped YAML (§7.3)
  const l2 = tryCodeBlock(llmOutput);
  if (l2) return l2;

  // Level 3: JSON fallback (§7.4)
  const l3 = tryJsonBlock(llmOutput);
  if (l3) return l3;

  // Level 4: Regex extraction (§7.5)
  const l4 = tryRegexExtraction(llmOutput);
  if (l4) return l4;

  // Level 5: Complete failure (§7.6)
  return {
    success: false,
    frontmatter: null,
    body: llmOutput,
    strategy: 'parse_failed',
  };
}

// ─── Level 1: Standard YAML fence (§7.2) ───

function tryYamlFence(text: string): ParsedOutput | null {
  // Match --- delimiters, tolerating prefix text before first ---
  // Claude occasionally prepends explanation text like "Here's my analysis:"
  const match = text.match(/^[\s\S]*?^---\n([\s\S]*?)\n^---/m);

  if (!match) {
    // Tolerate single --- at start (LLM forgot closing ---)
    const singleMatch = text.match(/^---\n([\s\S]+)$/m);
    if (singleMatch) {
      const yamlText = singleMatch[1]!;
      return attemptYamlParse(yamlText, '', 'yaml_fence');
    }
    return null;
  }

  const yamlText = match[1]!;
  const bodyStart = match.index! + match[0].length;
  const body = text.slice(bodyStart).trim();

  return attemptYamlParse(yamlText, body, 'yaml_fence');
}

// ─── Level 2: Code-block wrapped YAML (§7.3) ───

function tryCodeBlock(text: string): ParsedOutput | null {
  // Try yaml-tagged code block first
  let match = text.match(/```ya?ml\n([\s\S]*?)```/m);
  if (!match) {
    // Try untagged code block
    match = text.match(/```\n([\s\S]*?)```/m);
  }
  if (!match) return null;

  const yamlText = match[1]!;
  const body = text.replace(match[0], '').trim();

  return attemptYamlParse(yamlText, body, 'code_block');
}

// ─── Level 3: JSON fallback (§7.4) ───

function tryJsonBlock(text: string): ParsedOutput | null {
  // Try json code block
  let match = text.match(/```json\n([\s\S]*?)```/m);
  let jsonText: string | null = null;
  let matchedStr: string | null = null;

  if (match) {
    jsonText = match[1]!;
    matchedStr = match[0];
  } else {
    // Try bare JSON object using brace-balancing parser.
    // A greedy regex like /(\{[\s\S]*\})/m would swallow everything from
    // the first { to the last } in the entire document — catastrophic if
    // the Markdown body contains any braces (LaTeX, pseudocode, etc.).
    const balanced = extractBalancedJson(text);
    if (balanced) {
      jsonText = balanced;
      matchedStr = balanced;
    }
  }

  if (!jsonText || !matchedStr) return null;

  // Attempt 1: direct parse
  try {
    const frontmatter = JSON.parse(jsonText);
    if (frontmatter && typeof frontmatter === 'object') {
      const body = text.replace(matchedStr, '').trim();
      return { success: true, frontmatter, body, strategy: 'json_fallback' };
    }
  } catch { /* try repair */ }

  // Attempt 2: common JSON repairs
  try {
    const repaired = jsonrepair(jsonText);
    const frontmatter = JSON.parse(repaired);
    if (frontmatter && typeof frontmatter === 'object') {
      const body = text.replace(matchedStr, '').trim();
      return { success: true, frontmatter, body, strategy: 'json_repaired' };
    }
  } catch { /* fall through */ }

  return null;
}

// ─── Level 4: Regex extraction (§7.5) ───

function tryRegexExtraction(text: string): ParsedOutput | null {
  const result: Record<string, unknown> = {};
  let extracted = false;

  // Extract concept_mappings
  const mappings: Array<Record<string, unknown>> = [];
  const mappingPattern =
    /concept_id\s*[:=]\s*["']?(\w+)["']?\s*\n\s*relation\s*[:=]\s*["']?(\w+)["']?\s*\n\s*confidence\s*[:=]\s*([\d.]+)/gm;
  let match: RegExpExecArray | null;

  while ((match = mappingPattern.exec(text)) !== null) {
    const evidenceText = extractNearbyEvidence(text, match.index + match[0].length);
    mappings.push({
      concept_id: match[1]!,
      relation: match[2]!,
      confidence: parseFloat(match[3]!),
      evidence: evidenceText ?? undefined,
    });
    extracted = true;
  }
  result['concept_mappings'] = mappings;

  // Extract suggested_new_concepts
  const suggestions: Array<{ term: string }> = [];
  const termPattern = /term\s*[:=]\s*["']([^"'\n]+)["']/gm;
  while ((match = termPattern.exec(text)) !== null) {
    suggestions.push({ term: match[1]! });
    extracted = true;
  }
  result['suggested_new_concepts'] = suggestions;

  // Extract paper_type
  const typeMatch = text.match(/paper_type\s*[:=]\s*["']?(\w+)["']?/m);
  if (typeMatch) {
    result['paper_type'] = typeMatch[1]!;
    extracted = true;
  }

  if (!extracted) return null;

  return {
    success: true,
    frontmatter: result,
    body: text,
    strategy: 'regex_extraction',
  };
}

/**
 * Search ±500 chars around a position for evidence text in quotes.
 */
function extractNearbyEvidence(text: string, position: number): string | null {
  const start = Math.max(0, position - 200);
  const end = Math.min(text.length, position + 500);
  const region = text.slice(start, end);

  // Look for evidence keyword followed by quoted text
  const evidenceMatch = region.match(/evidence\s*[:=]\s*["']([^"'\n]{10,})["']/i);
  if (evidenceMatch) return evidenceMatch[1]!;

  // Look for evidence keyword followed by unquoted text on same line
  const unquotedMatch = region.match(/evidence\s*[:=]\s*([^\n]{10,})/i);
  if (unquotedMatch) return unquotedMatch[1]!.trim();

  return null;
}

// ─── Brace-balancing JSON extractor ───

/**
 * Extract the first balanced JSON object from text using a cursor-based
 * brace counter. Much safer than greedy regex /\{[\s\S]*\}/ which would
 * swallow everything from first { to last } in the entire document.
 *
 * Handles string literals (skips braces inside quoted strings).
 * Returns null if no balanced object is found.
 */
function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null; // Unbalanced braces
}

// ─── YAML parse with auto-repair ───

function attemptYamlParse(
  yamlText: string,
  body: string,
  baseStrategy: 'yaml_fence' | 'code_block',
): ParsedOutput | null {
  // Attempt 1: raw parse
  try {
    const result = yaml.load(yamlText, { schema: yaml.FAILSAFE_SCHEMA });
    if (result && typeof result === 'object') {
      return {
        success: true,
        frontmatter: result as Record<string, unknown>,
        body,
        strategy: baseStrategy,
      };
    }
  } catch { /* try repair */ }

  // Attempt 2: auto-repair then parse (§8)
  const { text: repaired, appliedRules } = applyRepairRules(yamlText);
  try {
    const result = yaml.load(repaired, { schema: yaml.FAILSAFE_SCHEMA });
    if (result && typeof result === 'object') {
      const repairedStrategy: ParseStrategy =
        baseStrategy === 'yaml_fence' ? 'yaml_fence_repaired' : 'code_block_repaired';
      return {
        success: true,
        frontmatter: result as Record<string, unknown>,
        body,
        strategy: repairedStrategy,
        repairRules: appliedRules,
      };
    }
  } catch { /* give up on YAML */ }

  // Attempt 3: try DEFAULT_SCHEMA (more permissive type coercion)
  try {
    const result = yaml.load(repaired);
    if (result && typeof result === 'object') {
      const repairedStrategy: ParseStrategy =
        baseStrategy === 'yaml_fence' ? 'yaml_fence_repaired' : 'code_block_repaired';
      return {
        success: true,
        frontmatter: result as Record<string, unknown>,
        body,
        strategy: repairedStrategy,
        repairRules: appliedRules,
      };
    }
  } catch { /* give up */ }

  return null;
}

// ─── Diagnostic builder (§7.6) ───

export function buildParseDiagnostic(llmOutput: string): Record<string, unknown> {
  return {
    outputLength: llmOutput.length,
    hasTripleDash: llmOutput.includes('---'),
    hasCodeBlock: llmOutput.includes('```'),
    hasYamlKeywords: /concept_mappings|concept_id|relation|confidence/.test(llmOutput),
    hasSuggestedConcepts: /suggested_new_concepts/i.test(llmOutput),
    preview: llmOutput.slice(0, 500),
  };
}
