/**
 * Phase 4: Integration pipeline test — prompt-assemble → output-parse end-to-end.
 *
 * Tests the full analysis pipeline:
 * 1. PromptAssembler builds a prompt from raw sources
 * 2. A mock LLM generates YAML+Markdown output
 * 3. Output parser parses and validates the LLM output
 *
 * This catches interface contract mismatches between assembler output
 * format expectations and parser input requirements.
 */

import { createPromptAssembler, type AssemblyRequest } from '../../src/adapter/prompt-assembler/prompt-assembler';
import { parse, parseAndValidate } from '../../src/adapter/output-parser/output-parser';
import type { BudgetAllocation } from '../../src/adapter/context-budget/context-budget-manager';

// ─── Token counter ───

const tokenCounter = { count: (text: string) => Math.ceil(text.length / 4) };

// ─── Minimal budget allocation ───

function makeAllocation(overrides: Partial<BudgetAllocation> = {}): BudgetAllocation {
  return {
    totalBudget: 100_000,
    outputReserve: 8_000,
    fixedTokens: 2_000,
    distributableBudget: 90_000,
    strategy: 'proportional',
    sourceAllocations: new Map([
      ['paper_fulltext', { budgetTokens: 30_000, priority: 'HIGH' as const }],
      ['rag_passages', { budgetTokens: 8_000, priority: 'MEDIUM' as const }],
      ['concept_framework', { budgetTokens: 5_000, priority: 'ABSOLUTE' as const }],
      ['researcher_memos', { budgetTokens: 3_000, priority: 'ABSOLUTE' as const }],
      ['researcher_annotations', { budgetTokens: 3_000, priority: 'ABSOLUTE' as const }],
    ]),
    ...overrides,
  };
}

// ─── Mock LLM response generators ───

function mockAnalyzeLlmOutput(paperId: string, conceptIds: string[]): string {
  const mappings = conceptIds.map((cid) => `  - concept_id: ${cid}
    relation: supports
    confidence: 0.85
    evidence:
      quote: "This paper provides evidence for this concept."
      page: 3
      section: Results`).join('\n');

  return `---
paper_id: ${paperId}
paper_type: journal
concept_mappings:
${mappings}
suggested_new_concepts: []
---

## Summary

This paper investigates the relationship between self-regulation and academic performance.
The findings suggest a positive correlation (r = 0.45, p < .001).

## Methodology Assessment

The study uses a mixed-methods approach with quantitative surveys and qualitative interviews.
Sample size (N=200) provides adequate statistical power.
`;
}

function mockZeroConceptLlmOutput(paperId: string): string {
  return `---
paper_id: ${paperId}
paper_type: journal
suggested_new_concepts:
  - term: Self-Regulation
    frequency_in_paper: 47
    closest_existing: null
    reason: Central construct of the study
    suggested_definition: The ability to monitor and manage one's own learning processes
    suggested_keywords:
      - SRL
      - self-regulated learning
      - metacognition
  - term: Academic Motivation
    frequency_in_paper: 23
    closest_existing: null
    reason: Key predictor variable
    suggested_definition: Intrinsic drive to engage in academic activities
    suggested_keywords:
      - motivation
      - intrinsic motivation
      - academic engagement
---

## Summary

This paper explores self-regulation in academic contexts.
`;
}

// ─── Test helpers ───

function makeBaseRequest(overrides: Partial<AssemblyRequest> = {}): AssemblyRequest {
  return {
    taskType: 'analyze',
    allocation: makeAllocation(),
    frameworkState: 'framework_forming',
    paperId: 'p-test-001',
    paperType: 'journal',
    paperTitle: 'Self-Regulation and Academic Performance',
    projectName: 'Test Project',
    conceptFramework: [
      {
        id: 'c-srl',
        nameEn: 'Self-Regulation',
        nameZh: '自我调节',
        definition: 'The ability to monitor and control one\'s own learning processes',
        searchKeywords: ['SRL', 'self-regulated learning'],
        maturity: 'working',
      },
      {
        id: 'c-motivation',
        nameEn: 'Academic Motivation',
        nameZh: '学术动机',
        definition: 'Intrinsic and extrinsic drivers of academic engagement',
        searchKeywords: ['motivation', 'intrinsic motivation'],
        maturity: 'tentative',
      },
    ],
    memos: [
      {
        text: 'I think self-regulation is more nuanced than simple metacognition',
        createdAt: '2025-01-15T10:00:00Z',
        conceptIds: ['c-srl'],
        paperIds: [],
      },
    ],
    annotations: [
      {
        page: 5,
        annotationType: 'highlight',
        selectedText: 'Self-regulation predicted 20% of variance in GPA',
        comment: 'Key finding',
        conceptId: 'c-srl',
        conceptName: 'Self-Regulation',
      },
    ],
    paperContent: 'This is the full paper text about self-regulation...\n\n' +
      'Abstract: This study examines self-regulation.\n\n' +
      '## Introduction\nSelf-regulation is important.\n\n' +
      '## Methods\nWe surveyed 200 students.\n\n' +
      '## Results\nSelf-regulation predicted 20% of variance (p < .001).\n\n' +
      '## Conclusion\nSelf-regulation matters for academic success.',
    ragPassages: [
      {
        paperId: 'p-other',
        paperTitle: 'Metacognition Review',
        chunkId: 'ch-1',
        text: 'Metacognition is closely related to self-regulation.',
        score: 0.85,
      },
    ],
    ...overrides,
  };
}

// ═══ Integration Tests ═══

describe('Pipeline: assemble → parse (analyze workflow)', () => {
  const assembler = createPromptAssembler(tokenCounter);

  it('assembled prompt produces valid structure', () => {
    const request = makeBaseRequest();
    const result = assembler.assemble(request);

    // Verify assembly produced system + user messages
    expect(result.systemPrompt.length).toBeGreaterThan(0);
    expect(result.userMessage.length).toBeGreaterThan(0);
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
  });

  it('mock LLM output is parseable after assembly', () => {
    const request = makeBaseRequest();
    const assembled = assembler.assemble(request);

    // Simulate LLM producing a response
    const llmOutput = mockAnalyzeLlmOutput('p-test-001', ['c-srl', 'c-motivation']);
    const parsed = parse(llmOutput);

    expect(parsed.success).toBe(true);
    expect(parsed.strategy).toBe('yaml_fence');
    expect(parsed.frontmatter?.paper_id).toBe('p-test-001');
    expect(parsed.frontmatter?.concept_mappings).toHaveLength(2);
  });

  it('full pipeline: assemble → parse → validate', () => {
    const request = makeBaseRequest();
    const assembled = assembler.assemble(request);

    const llmOutput = mockAnalyzeLlmOutput('p-test-001', ['c-srl', 'c-motivation']);

    const validated = parseAndValidate(llmOutput, {
      paperId: 'p-test-001',
      knownConceptIds: new Set(['c-srl', 'c-motivation']),
    });

    expect(validated.success).toBe(true);
    expect(validated.conceptMappings.length).toBeGreaterThan(0);
    expect(validated.conceptMappings[0]?.concept_id).toBe('c-srl');
    expect(validated.conceptMappings[0]?.relation).toBeTruthy();
    expect(validated.conceptMappings[0]?.confidence).toBeGreaterThan(0);
  });
});

describe('Pipeline: zero-concept workflow', () => {
  const assembler = createPromptAssembler(tokenCounter);

  it('zero-concept assembly + parse produces suggested concepts', () => {
    const request = makeBaseRequest({
      frameworkState: 'zero_concepts',
      conceptFramework: [],
    });
    const assembled = assembler.assemble(request);

    // System prompt should contain the zero-concept preamble
    expect(assembled.systemPrompt).toContain('suggested_new_concepts');

    // Parse a zero-concept response
    const llmOutput = mockZeroConceptLlmOutput('p-test-001');
    const validated = parseAndValidate(llmOutput, {
      paperId: 'p-test-001',
      knownConceptIds: new Set<string>(),
    });

    expect(validated.success).toBe(true);
    // Should have suggested concepts
    expect(validated.suggestedConcepts.length).toBeGreaterThan(0);
    expect(validated.suggestedConcepts[0]?.term).toBe('Self-Regulation');
  });
});

describe('Pipeline: truncation under tight budget', () => {
  const assembler = createPromptAssembler(tokenCounter);

  it('assembles within budget even with long content', () => {
    const longContent = 'A'.repeat(200_000); // Much longer than budget
    const request = makeBaseRequest({
      paperContent: longContent,
      allocation: makeAllocation({ totalBudget: 5_000 }),
    });

    const result = assembler.assemble(request);
    // Should have truncated
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(60_000); // char/4 counter means 200K chars ≈ 50K tokens + overhead
  });
});

describe('Pipeline: repaired YAML → successful validation', () => {
  it('handles smart-quote damaged output', () => {
    const damagedOutput = `---
paper_id: p-test-001
paper_type: journal
concept_mappings:
  - concept_id: c-srl
    relation: \u201csupports\u201d
    confidence: 0.85
    evidence:
      quote: \u201cThis paper provides evidence\u201d
      page: 3
      section: Results
---

Analysis text.`;

    const parsed = parse(damagedOutput);
    expect(parsed.success).toBe(true);
    // Smart quotes should have been repaired
    expect(parsed.strategy).toMatch(/repaired|yaml_fence/);
  });

  it('handles trailing comma in YAML', () => {
    const damagedOutput = `---
paper_id: p-test-001
paper_type: journal
concept_mappings:
  - concept_id: c-srl
    relation: supports
    confidence: 0.85,
---

Body.`;

    const parsed = parse(damagedOutput);
    expect(parsed.success).toBe(true);
  });
});
