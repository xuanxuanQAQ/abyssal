import { jsonrepair } from 'jsonrepair';

import type { Logger } from '../../../core/infra/logger';
import { extractBalancedJson } from '../utils';
import {
  validateConceptMappings,
  type ConceptLookup,
  type ValidatedMapping,
} from '../../output-parser/field-validator';
import {
  parseSuggestedConcepts,
  type NormalizedSuggestion,
} from '../../output-parser/suggestion-parser';
import { failSave } from '../../output-parser/level5-fail-save';
import type { ParseDiagnostics } from '../../output-parser/diagnostics';

export interface StructuredAnalyzeParseContext {
  paperId: string;
  model?: string | undefined;
  workflow?: string | undefined;
  frameworkState?: string | undefined;
  conceptLookup?: ConceptLookup | undefined;
  knownConceptIds?: Set<string> | undefined;
  getConceptName?: ((id: string) => string | null) | undefined;
  workspaceRoot?: string | undefined;
}

export interface StructuredAnalyzeOutput {
  success: boolean;
  summary: string;
  body: string;
  conceptMappings: ValidatedMapping[];
  suggestedConcepts: NormalizedSuggestion[];
  warnings: string[];
  rawPath: string | null;
  diagnostics: ParseDiagnostics | null;
}

export const ANALYZE_STRUCTURED_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  name: 'analyze_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      analysis_markdown: { type: 'string' },
      concept_mappings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            concept_id: { type: 'string' },
            relation: { type: 'string' },
            confidence: {
              anyOf: [
                { type: 'number' },
                { type: 'string' },
                { type: 'boolean' },
              ],
            },
            evidence: {
              type: 'object',
              additionalProperties: true,
              properties: {
                en: { type: 'string' },
                original: { type: 'string' },
                original_lang: { type: 'string' },
                chunk_id: { type: ['string', 'null'] },
                page: { type: ['number', 'null'] },
                annotation_id: { type: ['string', 'null'] },
              },
            },
          },
          required: ['concept_id', 'relation', 'confidence', 'evidence'],
        },
      },
      suggested_new_concepts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            term: { type: 'string' },
            frequency_in_paper: { type: 'number' },
            closest_existing: { type: ['string', 'null'] },
            reason: { type: 'string' },
            suggested_definition: { type: ['string', 'null'] },
            suggested_keywords: {
              anyOf: [
                {
                  type: 'array',
                  items: { type: 'string' },
                },
                { type: 'null' },
              ],
            },
          },
          required: ['term', 'frequency_in_paper', 'closest_existing', 'reason', 'suggested_definition', 'suggested_keywords'],
        },
      },
    },
    required: ['summary', 'analysis_markdown', 'concept_mappings', 'suggested_new_concepts'],
  },
};

export function parseStructuredAnalyzeOutput(
  llmOutput: string,
  context: StructuredAnalyzeParseContext,
  logger?: Logger,
): StructuredAnalyzeOutput {
  const cleaned = preprocessStructuredOutput(llmOutput);
  const parsed = parseStructuredJson(cleaned);

  if (parsed == null || typeof parsed !== 'object') {
    const { rawPath, diagnostics } = failSave(llmOutput, cleaned, {
      paperId: context.paperId,
      model: context.model,
      workflow: context.workflow,
      frameworkState: context.frameworkState,
      workspaceRoot: context.workspaceRoot,
    }, logger);

    return {
      success: false,
      summary: '',
      body: llmOutput,
      conceptMappings: [],
      suggestedConcepts: [],
      warnings: ['Structured analyze output parse failed'],
      rawPath,
      diagnostics,
    };
  }

  const record = parsed as Record<string, unknown>;
  const mappingResult = validateConceptMappings(
    Array.isArray(record['concept_mappings']) ? record['concept_mappings'] : [],
    context.conceptLookup,
  );
  let suggestions = parseSuggestedConcepts(record['suggested_new_concepts'], {
    knownConceptIds: context.knownConceptIds,
    getConceptName: context.getConceptName,
  });

  if (mappingResult.divertedToSuggestions.length > 0) {
    const existingTerms = new Set(suggestions.map((suggestion) => suggestion.termNormalized));
    for (const diverted of mappingResult.divertedToSuggestions) {
      const termNormalized = diverted.concept_id.toLowerCase();
      if (existingTerms.has(termNormalized)) continue;
      suggestions.push({
        term: diverted.concept_id,
        termNormalized,
        frequencyInPaper: 1,
        closestExisting: null,
        reason: `Diverted from concept_mappings: unknown concept_id "${diverted.concept_id}" (relation: ${diverted.relation}, confidence: ${diverted.confidence})`,
        suggestedDefinition: null,
        suggestedKeywords: null,
      });
      existingTerms.add(termNormalized);
    }
  }

  return {
    success: true,
    summary: asString(record['summary']),
    body: asString(record['analysis_markdown']),
    conceptMappings: mappingResult.mappings,
    suggestedConcepts: suggestions,
    warnings: mappingResult.warnings,
    rawPath: null,
    diagnostics: null,
  };
}

function preprocessStructuredOutput(rawOutput: string): string {
  return rawOutput
    .replace(/^\uFEFF/, '')
    .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function parseStructuredJson(text: string): unknown {
  const candidates = [
    text,
    extractJsonCodeBlock(text),
    extractBalancedJson(text),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);

  for (const candidate of candidates) {
    const direct = tryParseJson(candidate);
    if (direct != null) return direct;

    const repaired = tryParseJson(jsonrepair(candidate));
    if (repaired != null) return repaired;
  }

  return null;
}

function extractJsonCodeBlock(text: string): string | null {
  const match = text.match(/```json\s*\n([\s\S]*?)```/m);
  return match?.[1] ?? null;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}