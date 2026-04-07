/**
 * JIT Concept Mapping — Stage 2 of Cascading Distillation.
 *
 * Light Read, Deep Reasoning:
 *   Input:  paper_analysis_base (~800 tokens) + concept_subset (~1500 tokens)
 *   Output: paper_concept_map entries
 *
 * Key insight: does NOT re-read the paper. Works entirely from the
 * compressed base layer + concept definitions. This makes concept changes
 * near-instant to recompute (~1-2s per paper).
 *
 * Triggered: on-demand when user opens Analysis/Graph view, asks about
 * concept relevance in chat, or after concept framework changes.
 */

import type { LlmClient } from '../../llm-client/llm-client';
import type { Logger } from '../../../core/infra/logger';

// ─── Types ───

export interface MappingInput {
  paperId: string;
  base: {
    claims: string[];
    methodTags: string[];
    keyTerms: string[];
    contributionSummary: string | null;
  };
  concepts: Array<{
    id: string;
    nameEn: string;
    nameZh: string;
    definition: string;
    searchKeywords: string[];
    maturity: string;
  }>;
}

export interface MappingOutput {
  mappings: Array<{
    conceptId: string;
    relation: 'supports' | 'challenges' | 'extends' | 'operationalizes' | 'irrelevant';
    confidence: number;
    evidence: string;
  }>;
  suggestedNewConcepts: Array<{
    term: string;
    reason: string;
    frequencyInPaper: number;
  }>;
}

// ─── Prompt ───

const MAPPING_SYSTEM = `You are a concept mapping specialist. Given a paper's structural summary and a concept framework, determine how the paper relates to each concept.

For each concept, determine:
- relation: supports | challenges | extends | operationalizes | irrelevant
- confidence: 0.0-1.0 (how confident you are in this mapping)
- evidence: brief quote or explanation from the paper's claims/methods that supports this mapping

Also suggest any new concepts the paper discusses that are NOT in the current framework.

Return ONLY valid JSON. Omit concepts with relation "irrelevant" and confidence < 0.3.`;

const MAPPING_USER = `Paper Summary:
- Claims: {claims}
- Methods: {methods}
- Key Terms: {terms}
- Contribution: {contribution}

Concept Framework:
{concepts}

Return JSON:
{
  "mappings": [
    { "conceptId": "id", "relation": "supports", "confidence": 0.85, "evidence": "..." }
  ],
  "suggested_new_concepts": [
    { "term": "...", "reason": "...", "frequency_in_paper": 3 }
  ]
}`;

// ─── Mapping ───

export async function computeJitMapping(
  input: MappingInput,
  llmClient: LlmClient,
  logger: Logger,
): Promise<MappingOutput> {
  if (input.concepts.length === 0) {
    return { mappings: [], suggestedNewConcepts: [] };
  }

  const conceptsBlock = input.concepts
    .map((c) => `- **${c.id}** (${c.nameEn} / ${c.nameZh}): ${c.definition} [keywords: ${c.searchKeywords.join(', ')}] [maturity: ${c.maturity}]`)
    .join('\n');

  const userPrompt = MAPPING_USER
    .replace('{claims}', input.base.claims.join('; ') || '(none)')
    .replace('{methods}', input.base.methodTags.join(', ') || '(none)')
    .replace('{terms}', input.base.keyTerms.join(', ') || '(none)')
    .replace('{contribution}', input.base.contributionSummary || '(not available)')
    .replace('{concepts}', conceptsBlock);

  // Use a cheaper/faster model for stage 2 since context is short
  const response = await llmClient.complete({
    systemPrompt: MAPPING_SYSTEM,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    model: llmClient.resolveModel('analyze.intermediate'),
    temperature: 0.1,
  });

  const content = response.text;

  try {
    const parsed = JSON.parse(content);
    return {
      mappings: Array.isArray(parsed.mappings)
        ? parsed.mappings
          .filter((m: any) => typeof m.conceptId === 'string' && typeof m.relation === 'string')
          .map((m: any) => ({
            conceptId: m.conceptId,
            relation: m.relation,
            confidence: typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0.5,
            evidence: typeof m.evidence === 'string' ? m.evidence.slice(0, 500) : '',
          }))
        : [],
      suggestedNewConcepts: Array.isArray(parsed.suggested_new_concepts)
        ? parsed.suggested_new_concepts
          .filter((s: any) => typeof s.term === 'string')
          .map((s: any) => ({
            term: s.term,
            reason: typeof s.reason === 'string' ? s.reason.slice(0, 200) : '',
            frequencyInPaper: typeof s.frequency_in_paper === 'number' ? s.frequency_in_paper : 1,
          }))
        : [],
    };
  } catch (err) {
    logger.warn('Failed to parse JIT mapping output', {
      paperId: input.paperId,
      error: (err as Error).message,
    });
    return { mappings: [], suggestedNewConcepts: [] };
  }
}
