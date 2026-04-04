import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPromptAssembler, type AssemblyRequest } from '../../src/adapter/prompt-assembler/prompt-assembler';
import { parseAndValidate } from '../../src/adapter/output-parser/output-parser';
import type { BudgetAllocation } from '../../src/adapter/context-budget/context-budget-manager';

const tokenCounter = { count: (text: string) => Math.ceil(text.length / 4) };

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

function makeBaseRequest(overrides: Partial<AssemblyRequest> = {}): AssemblyRequest {
  return {
    taskType: 'analyze',
    allocation: makeAllocation(),
    frameworkState: 'framework_forming',
    paperId: 'p-failure-001',
    paperType: 'journal',
    paperTitle: 'Failure Path Paper',
    projectName: 'Failure Regression',
    conceptFramework: [
      {
        id: 'c-srl',
        nameEn: 'Self-Regulation',
        nameZh: '自我调节',
        definition: 'The ability to monitor and regulate one\'s own learning behaviors',
        searchKeywords: ['self-regulation', 'srl'],
        maturity: 'working',
      },
    ],
    memos: [
      {
        text: 'Need to distinguish genuine mapping failures from parser noise.',
        createdAt: '2025-01-15T10:00:00Z',
        conceptIds: ['c-srl'],
        paperIds: [],
      },
    ],
    annotations: [
      {
        page: 3,
        annotationType: 'highlight',
        selectedText: 'Self-regulation predicted variance in GPA.',
        comment: 'Likely core claim',
        conceptId: 'c-srl',
        conceptName: 'Self-Regulation',
      },
    ],
    paperContent: [
      'Abstract',
      'This paper studies self-regulation in academic settings.',
      '',
      '## Introduction',
      'Self-regulation is central to long-term academic performance.',
      '',
      '## Results',
      'The strongest effect appears in sustained study planning.',
      '',
      '## Conclusion',
      'Self-regulation remains a stable explanatory factor.',
    ].join('\n'),
    ragPassages: [
      {
        paperId: 'p-related',
        paperTitle: 'Related Literature',
        chunkId: 'chunk-1',
        text: 'Self-regulation often correlates with persistence and planning.',
        score: 0.88,
      },
    ],
    ...overrides,
  };
}

describe('analysis pipeline failure-path integration', () => {
  const assembler = createPromptAssembler(tokenCounter);

  it('returns diagnostics and no pseudo mappings when prompt assembly succeeds but parsing totally fails', () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'abyssal-analysis-fail-'));
    try {
      const assembled = assembler.assemble(makeBaseRequest());
      expect(assembled.systemPrompt.length).toBeGreaterThan(0);
      expect(assembled.userMessage.length).toBeGreaterThan(0);

      const result = parseAndValidate('plain prose with no YAML, JSON, or extractable mappings', {
        paperId: 'p-failure-001',
        workspaceRoot,
        conceptLookup: {
          exists: (id) => id === 'c-srl',
          allIds: new Set(['c-srl']),
        },
      });

      expect(result.success).toBe(false);
      expect(result.diagnostics).not.toBeNull();
      expect(result.rawPath).toContain('p-failure-001');
      expect(result.conceptMappings).toEqual([]);
      expect(result.suggestedConcepts).toEqual([]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('salvages a lightly damaged YAML response into valid mappings instead of dropping the analysis result', () => {
    const assembled = assembler.assemble(makeBaseRequest());
    expect(assembled.templateId).toBe('analyze-empirical');

    const damagedOutput = `---
paper_id: p-failure-001
paper_type: journal
concept_mappings:
  - concept_id: c-srl
    relation: \u201csupports\u201d
    confidence: 0.85
    evidence: \u201cSelf-regulation predicted GPA\u201d
---

Recovered summary.`;

    const result = parseAndValidate(damagedOutput, {
      paperId: 'p-failure-001',
      conceptLookup: {
        exists: (id) => id === 'c-srl',
        allIds: new Set(['c-srl']),
      },
    });

    expect(result.success).toBe(true);
    expect(result.conceptMappings).toHaveLength(1);
    expect(result.conceptMappings[0]).toMatchObject({
      concept_id: 'c-srl',
      relation: 'supports',
    });
  });

  it('keeps zero-mapping analysis results valid and explainable when the model returns an empty mapping set', () => {
    const assembled = assembler.assemble(makeBaseRequest());
    expect(assembled.estimatedInputTokens).toBeGreaterThan(0);

    const emptyOutput = `---
paper_id: p-failure-001
paper_type: journal
concept_mappings: []
suggested_new_concepts: []
---

The paper is descriptive but does not clearly operationalize the tracked concept.`;

    const result = parseAndValidate(emptyOutput, {
      paperId: 'p-failure-001',
      conceptLookup: {
        exists: (id) => id === 'c-srl',
        allIds: new Set(['c-srl']),
      },
    });

    expect(result.success).toBe(true);
    expect(result.conceptMappings).toEqual([]);
    expect(result.suggestedConcepts).toEqual([]);
    expect(result.diagnostics).toBeNull();
  });
});