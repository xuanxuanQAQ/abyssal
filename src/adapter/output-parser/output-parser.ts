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
import { parseSuggestedConcepts, type NormalizedSuggestion, type SuggestionParseContext } from './suggestion-parser';
import { failSave, type FailSaveContext } from './level5-fail-save';
import { type ParseDiagnostics } from './diagnostics';

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
  /** Level 5: path to .raw.txt archive (only set on failure) */
  rawPath: string | null;
  /** Level 5: structured diagnostics (only set on failure) */
  diagnostics: ParseDiagnostics | null;
}

export interface ParseContext {
  paperId: string;
  model?: string;
  workflow?: string;
  frameworkState?: string;
  conceptLookup?: ConceptLookup;
  /** All known concept IDs — for suggestion closest_existing matching */
  knownConceptIds?: Set<string>;
  /** Concept name lookup for fuzzy matching */
  getConceptName?: (id: string) => string | null;
  /** Workspace root for Level 5 .raw.txt save */
  workspaceRoot?: string;
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
  // §1.3: Preprocess — remove backend noise
  const cleaned = preprocess(llmOutput);

  const parsed = parse(cleaned);

  if (!parsed.success || !parsed.frontmatter) {
    // §6: Level 5 — fail-save archive
    const failSaveCtx: FailSaveContext = {
      paperId: context.paperId,
      model: context.model,
      workflow: context.workflow,
      frameworkState: context.frameworkState,
      workspaceRoot: context.workspaceRoot,
    };
    const { rawPath, diagnostics } = failSave(llmOutput, cleaned, failSaveCtx, logger);

    return {
      success: false,
      frontmatter: null,
      body: llmOutput,
      strategy: 'parse_failed',
      repairRules: [],
      conceptMappings: [],
      suggestedConcepts: [],
      warnings: ['All parse strategies failed'],
      rawPath,
      diagnostics,
    };
  }

  // Field validation (§9)
  const rawMappings = parsed.frontmatter['concept_mappings'];
  const mappingResult = validateConceptMappings(
    Array.isArray(rawMappings) ? rawMappings : [],
    context.conceptLookup,
  );

  const rawSuggestions = parsed.frontmatter['suggested_new_concepts'];
  const suggestionCtx: SuggestionParseContext | undefined = context.knownConceptIds
    ? { knownConceptIds: context.knownConceptIds, getConceptName: context.getConceptName }
    : undefined;
  let suggestions = parseSuggestedConcepts(rawSuggestions, suggestionCtx);

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
    rawPath: null,
    diagnostics: null,
  };
}

// ─── §1.3: Preprocess — backend noise removal ───

/**
 * Remove known backend-specific noise from raw LLM output.
 */
function preprocess(rawOutput: string): string {
  let text = rawOutput;

  // Remove BOM marker
  text = text.replace(/^\uFEFF/, '');

  // Remove DeepSeek-Reasoner think chain (double safety — LLM Client should handle this too)
  text = text.replace(/^<think>[\s\S]*?<\/think>\s*/m, '');

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove trailing whitespace
  text = text.trimEnd();

  return text;
}

// ─── §2.2: looksLikeYaml heuristic ───

/**
 * Heuristic: does this text look like YAML content?
 * Returns true if ≥50% of non-empty lines match YAML patterns.
 */
function looksLikeYaml(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;

  const yamlPatterns = [
    /^\s*\w[\w_]*\s*:/, // key: value
    /^\s*-\s+/,          // - list item
    /^\s*#/,             // YAML comment
  ];

  let matchCount = 0;
  for (const line of lines) {
    if (yamlPatterns.some((p) => p.test(line))) {
      matchCount++;
    }
  }

  return matchCount / lines.length >= 0.5;
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
  // §2.1 Strategy A: Standard double --- delimiters, tolerating prefix text
  const match = text.match(/^[\s\S]*?^---[ \t]*\n([\s\S]*?)\n^---[ \t]*$/m);

  if (match) {
    const yamlText = match[1]!;
    const bodyStart = match.index! + match[0].length;
    const body = text.slice(bodyStart).trim();
    return attemptYamlParse(yamlText, body, 'yaml_fence');
  }

  // §2.1 Strategy B: Single --- at start (LLM forgot closing ---)
  // Use ## or ** as heuristic body boundary
  const singleMatch = text.match(/^---[ \t]*\n([\s\S]*?)(?:\n---|\n##|\n\*\*|$)/m);
  if (singleMatch) {
    const yamlText = singleMatch[1]!;
    const bodyStart = singleMatch.index! + singleMatch[0].length;
    const body = text.slice(bodyStart).trim();
    return attemptYamlParse(yamlText, body, 'yaml_fence');
  }

  // §2.1 Strategy C: No --- but content looks like YAML
  const first20Lines = text.split('\n').slice(0, 20).join('\n');
  if (looksLikeYaml(first20Lines)) {
    // Find boundary between YAML-like content and Markdown body
    const lines = text.split('\n');
    let splitPoint = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Body likely starts with a Markdown heading or blank line after YAML
      if (i > 3 && (line.startsWith('# ') || line.startsWith('## ') || line.startsWith('**'))) {
        splitPoint = lines.slice(0, i).join('\n').length;
        break;
      }
    }
    if (splitPoint > 0) {
      const yamlText = text.slice(0, splitPoint);
      const body = text.slice(splitPoint).trim();
      return attemptYamlParse(yamlText, body, 'yaml_fence');
    }
  }

  return null;
}

// ─── Level 2: Code-block wrapped YAML (§7.3) ───

function tryCodeBlock(text: string): ParsedOutput | null {
  // §3.1 Strategy A: yaml/yml tagged code block
  const matchA = text.match(/```ya?ml\s*\n([\s\S]*?)```/m);
  if (matchA) {
    const yamlText = matchA[1]!;
    const body = text.replace(matchA[0], '').trim();
    return attemptYamlParse(yamlText, body, 'code_block');
  }

  // §3.1 Strategy B: untagged code block that looks like YAML
  const matchB = text.match(/```\s*\n([\s\S]*?)```/m);
  if (matchB && looksLikeYaml(matchB[1]!)) {
    const yamlText = matchB[1]!;
    const body = text.replace(matchB[0], '').trim();
    return attemptYamlParse(yamlText, body, 'code_block');
  }

  // §3.1 Strategy C: multiple code blocks — take first YAML-like one
  const allBlocks = [...text.matchAll(/```(?:\w*)\s*\n([\s\S]*?)```/gm)];
  for (const block of allBlocks) {
    if (looksLikeYaml(block[1]!)) {
      const yamlText = block[1]!;
      const body = text.replace(block[0], '').trim();
      return attemptYamlParse(yamlText, body, 'code_block');
    }
  }

  return null;
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

  // ── §5.3: Extract concept_mappings ──
  const mappings: Array<Record<string, unknown>> = [];
  const seenConceptIds = new Set<string>();

  // Pattern A: Standard YAML-style multi-line (most common variant)
  const patternA =
    /concept_id\s*[:=]\s*["']?(\w+)["']?\s*\n\s*relation\s*[:=]\s*["']?(\w+)["']?\s*\n\s*confidence\s*[:=]\s*([\d.]+)/gm;
  let match: RegExpExecArray | null;

  while ((match = patternA.exec(text)) !== null) {
    const conceptId = match[1]!;
    if (seenConceptIds.has(conceptId)) continue;
    seenConceptIds.add(conceptId);
    mappings.push({
      concept_id: conceptId,
      relation: match[2]!,
      confidence: parseFloat(match[3]!),
      evidence: extractNearbyEvidence(text, match.index + match[0].length),
    });
    extracted = true;
  }

  // Pattern B: Compact format — "theory_of_mind: supports (0.85)"
  const patternB =
    /(\w+)\s*[:=]\s*(supports|challenges|extends|operationalizes)\s*\(?\s*([\d.]+)\s*\)?/gm;
  while ((match = patternB.exec(text)) !== null) {
    const conceptId = match[1]!;
    if (seenConceptIds.has(conceptId)) continue;
    seenConceptIds.add(conceptId);
    mappings.push({
      concept_id: conceptId,
      relation: match[2]!,
      confidence: parseFloat(match[3]!),
      evidence: extractNearbyEvidence(text, match.index + match[0].length),
    });
    extracted = true;
  }

  // Pattern C: Table format — | concept_id | relation | confidence |
  const patternC =
    /\|\s*(\w+)\s*\|\s*(supports|challenges|extends|operationalizes|irrelevant)\s*\|\s*([\d.]+)\s*\|/gm;
  while ((match = patternC.exec(text)) !== null) {
    const conceptId = match[1]!;
    if (seenConceptIds.has(conceptId)) continue;
    seenConceptIds.add(conceptId);
    mappings.push({
      concept_id: conceptId,
      relation: match[2]!,
      confidence: parseFloat(match[3]!),
      evidence: extractNearbyEvidence(text, match.index + match[0].length),
    });
    extracted = true;
  }

  result['concept_mappings'] = mappings;

  // ── §5.5: Extract suggested_new_concepts ──
  const suggestions: Array<Record<string, unknown>> = [];
  const seenTerms = new Set<string>();

  // Pattern A: YAML-style term: "..."
  const termPattern = /term\s*[:=]\s*["']([^"'\n]{2,80})["']/gm;
  while ((match = termPattern.exec(text)) !== null) {
    const term = match[1]!.trim();
    if (seenTerms.has(term.toLowerCase())) continue;
    seenTerms.add(term.toLowerCase());

    const suggestion: Record<string, unknown> = { term };

    // Search nearby region for associated fields
    const region = text.slice(match.index, match.index + 500);

    const freqMatch = region.match(/frequency[_\s]*(?:in[_\s]*paper)?\s*[:=]\s*(\d+)/i);
    if (freqMatch) suggestion['frequency_in_paper'] = parseInt(freqMatch[1]!);

    const reasonMatch = region.match(/reason\s*[:=]\s*["']([^"']{10,300})["']/i);
    if (reasonMatch) suggestion['reason'] = reasonMatch[1]!.trim();

    const defMatch = region.match(/suggested[_\s]*definition\s*[:=]\s*["']([^"']{10,300})["']/i);
    if (defMatch) suggestion['suggested_definition'] = defMatch[1]!.trim();

    const kwMatch = region.match(/suggested[_\s]*keywords\s*[:=]\s*\[([^\]]{5,200})\]/i);
    if (kwMatch) {
      suggestion['suggested_keywords'] = kwMatch[1]!
        .split(',')
        .map((k: string) => k.replace(/["'\s]/g, '').trim())
        .filter((k: string) => k.length > 0);
    }

    suggestions.push(suggestion);
    extracted = true;
  }

  // Pattern B: Natural language suggestion mentions
  const naturalPattern =
    /(?:suggest|recommend|consider)\s+(?:adding|tracking|including)\s+['"]([^'"]{2,50})['"]/gim;
  while ((match = naturalPattern.exec(text)) !== null) {
    const term = match[1]!.trim();
    if (seenTerms.has(term.toLowerCase())) continue;
    seenTerms.add(term.toLowerCase());
    suggestions.push({ term });
    extracted = true;
  }

  result['suggested_new_concepts'] = suggestions;

  // ── §5.6: Extract paper_type ──
  const typeMatch = text.match(/paper_type\s*[:=]\s*["']?(\w+)["']?/im);
  if (typeMatch) {
    const typeVal = typeMatch[1]!.toLowerCase();
    const validTypes = ['journal', 'conference', 'theoretical', 'review', 'preprint', 'book', 'chapter'];
    result['paper_type'] = validTypes.includes(typeVal) ? typeVal : 'unknown';
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
 * §5.4: Search region after match position for evidence text.
 *
 * Three strategies:
 * 1. Explicit evidence: "..." or evidence: '...'
 * 2. Multi-line evidence: > or | block
 * 3. Evidence keyword to next key: boundary
 */
function extractNearbyEvidence(text: string, searchStartIndex: number): string | null {
  const searchRegion = text.slice(searchStartIndex, searchStartIndex + 800);

  // Strategy 1: explicit quoted evidence
  const quotedMatch = searchRegion.match(/evidence\s*[:=]\s*["']([^"']{10,300})["']/i);
  if (quotedMatch) return quotedMatch[1]!.trim();

  // Strategy 2: multi-line evidence (> or | block)
  // Fix #9: Use non-backtracking boundary (match until next top-level key or EOF)
  // instead of nested quantifier ((?:\s{2,}.*\n?)+) which causes catastrophic backtracking.
  const multilineMatch = searchRegion.match(/evidence\s*[:=]\s*[>|]\s*\n([\s\S]*?)(?=\n\S|$)/i);
  if (multilineMatch) {
    const evidenceText = multilineMatch[1]!.replace(/^\s{2,}/gm, '').trim();
    if (evidenceText.length >= 10) return evidenceText.slice(0, 300);
  }

  // Strategy 3: evidence keyword to next key:
  const afterEvidence = searchRegion.match(/evidence\s*[:=]\s*\n?\s*([\s\S]*?)(?:\n\s*\w+\s*[:=]|$)/i);
  if (afterEvidence) {
    const cleaned = afterEvidence[1]!.replace(/^[\s-]+/gm, '').trim();
    if (cleaned.length >= 10) return cleaned.slice(0, 300);
  }

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
