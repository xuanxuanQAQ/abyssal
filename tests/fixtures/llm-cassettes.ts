/**
 * LLM response cassettes for replay testing.
 *
 * Each cassette captures: prompt pattern, provider, model, and response.
 * Used for low-frequency provider regression and output stability tests.
 */

export interface LlmCassette {
  id: string;
  provider: string;
  model: string;
  promptPattern: string;
  response: {
    text: string;
    toolCalls: unknown[];
    usage: { inputTokens: number; outputTokens: number };
    finishReason: string;
  };
}

export const CASSETTE_ANALYZE_AFFORDANCE: LlmCassette = {
  id: 'analyze-affordance-001',
  provider: 'anthropic',
  model: 'claude-opus-4',
  promptPattern: 'analyze.*affordance',
  response: {
    text: `---
concept_mappings:
  - concept_id: affordance
    relation: supports
    confidence: 0.88
    evidence:
      en: "The paper presents affordance as a central construct in HCI"
      zh: "论文将可供性作为HCI的核心构念"
  - concept_id: ecological_psychology
    relation: extends
    confidence: 0.72
    evidence:
      en: "Extends Gibson's ecological approach"
      zh: "扩展了Gibson的生态学方法"
framework_state: complete
suggested_new_concepts: []
---

The paper provides a comprehensive analysis of affordance theory...`,
    toolCalls: [],
    usage: { inputTokens: 4200, outputTokens: 380 },
    finishReason: 'end_turn',
  },
};

export const CASSETTE_REWRITE_SELECTION: LlmCassette = {
  id: 'rewrite-selection-001',
  provider: 'anthropic',
  model: 'claude-opus-4',
  promptPattern: 'rewrite.*selection',
  response: {
    text: 'The revised passage demonstrates improved clarity and coherence, maintaining the original academic tone while enhancing readability through shorter sentences and more precise terminology.',
    toolCalls: [],
    usage: { inputTokens: 1800, outputTokens: 45 },
    finishReason: 'end_turn',
  },
};

export const CASSETTE_RETRIEVAL_EVIDENCE: LlmCassette = {
  id: 'retrieval-evidence-001',
  provider: 'anthropic',
  model: 'claude-opus-4',
  promptPattern: 'retrieve.*evidence',
  response: {
    text: `Based on the retrieved evidence from your library:

1. **[Smith2024]** (relevance: 0.92): "Affordances in digital environments require..."
2. **[Chen2023]** (relevance: 0.85): "The ecological approach to interface design..."
3. **[Wang2024]** (relevance: 0.78): "Cross-cultural studies of affordance perception..."

These passages collectively support the argument that affordance theory...`,
    toolCalls: [],
    usage: { inputTokens: 6500, outputTokens: 220 },
    finishReason: 'end_turn',
  },
};

export const CASSETTE_ASK_GENERAL: LlmCassette = {
  id: 'ask-general-001',
  provider: 'openai',
  model: 'gpt-4o',
  promptPattern: '.*',
  response: {
    text: 'Based on your research library, the concept of affordance has been discussed in 12 papers, with the strongest support coming from ecological psychology literature.',
    toolCalls: [],
    usage: { inputTokens: 3200, outputTokens: 55 },
    finishReason: 'stop',
  },
};

export const CASSETTE_GENERATE_SECTION_DEGRADED: LlmCassette = {
  id: 'generate-section-degraded-001',
  provider: 'anthropic',
  model: 'claude-opus-4',
  promptPattern: 'generate.*section',
  response: {
    text: 'I was unable to generate the full section due to insufficient evidence in the retrieval context. Here is a partial draft based on available information...',
    toolCalls: [],
    usage: { inputTokens: 8000, outputTokens: 30 },
    finishReason: 'end_turn',
  },
};

export const ALL_CASSETTES: LlmCassette[] = [
  CASSETTE_ANALYZE_AFFORDANCE,
  CASSETTE_REWRITE_SELECTION,
  CASSETTE_RETRIEVAL_EVIDENCE,
  CASSETTE_ASK_GENERAL,
  CASSETTE_GENERATE_SECTION_DEGRADED,
];
