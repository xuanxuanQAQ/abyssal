import { describe, expect, it } from 'vitest';
import { createPromptAssembler, type AssemblyRequest } from './prompt-assembler';
import type { BudgetAllocation } from '../context-budget/context-budget-manager';

const tokenCounter = { count: (text: string) => Math.ceil(text.length / 4) };

function makeAllocation(overrides: Partial<BudgetAllocation> = {}): BudgetAllocation {
  return {
    totalBudget: 16_000,
    outputReserve: 2_000,
    fixedTokens: 1_000,
    distributableBudget: 13_000,
    strategy: 'balanced',
    sourceAllocations: new Map([
      ['paper_fulltext', { budgetTokens: 400, priority: 'HIGH' as const }],
      ['rag_passages', { budgetTokens: 200, priority: 'MEDIUM' as const }],
      ['concept_framework', { budgetTokens: 200, priority: 'ABSOLUTE' as const }],
      ['researcher_memos', { budgetTokens: 120, priority: 'ABSOLUTE' as const }],
      ['researcher_annotations', { budgetTokens: 120, priority: 'ABSOLUTE' as const }],
    ]),
    ragTopK: 6,
    skipReranker: false,
    skipQueryExpansion: false,
    truncated: false,
    truncationDetails: [],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AssemblyRequest> = {}): AssemblyRequest {
  return {
    taskType: 'analyze',
    allocation: makeAllocation(),
    frameworkState: 'framework_forming',
    paperId: 'paper-golden-1',
    paperType: 'journal',
    paperTitle: 'A Stable Prompt Example',
    projectName: 'Prompt Regression',
    outputLanguage: '中文',
    conceptFramework: [
      {
        id: 'concept-1',
        nameEn: 'Absorptive Capacity',
        nameZh: '吸收能力',
        definition: 'The ability to recognize, assimilate, and apply knowledge.',
        searchKeywords: ['absorptive capacity', 'knowledge transfer'],
        maturity: 'working',
      },
    ],
    memos: [
      {
        text: 'Memo should appear before annotations in the user payload.',
        createdAt: '2025-01-15T10:00:00Z',
        conceptIds: ['concept-1'],
        paperIds: [],
      },
    ],
    annotations: [
      {
        page: 2,
        annotationType: 'highlight',
        selectedText: 'Absorptive capacity explains the variance in adoption speed.',
        comment: 'Directly relevant quote',
        conceptId: 'concept-1',
        conceptName: 'Absorptive Capacity',
      },
    ],
    paperContent: [
      '# Abstract',
      'This study examines absorptive capacity and adoption speed.',
      '',
      '## Introduction',
      'Introductory context. '.repeat(40),
      '',
      '## Results',
      'Results section. '.repeat(40),
      '',
      '## Conclusion',
      'Absorptive capacity remains central to the findings.',
    ].join('\n'),
    ragPassages: [
      {
        paperId: 'paper-other',
        paperTitle: 'Related Cross-Paper Evidence',
        chunkId: 'chunk-7',
        text: 'Prior work links absorptive capacity to implementation speed.',
        score: 0.91,
      },
    ],
    ...overrides,
  };
}

describe('PromptAssembler golden behavior', () => {
  const assembler = createPromptAssembler(tokenCounter);

  it('keeps memo, annotation, fulltext, and rag blocks in a stable order for analyze prompts', () => {
    const result = assembler.assemble(makeRequest());
    const userMessage = result.userMessage;

    const memoIndex = userMessage.indexOf("## Researcher's Intuitions & Notes");
    const annotationIndex = userMessage.indexOf("## Researcher's Annotations");
    const fulltextIndex = userMessage.indexOf('## Paper: A Stable Prompt Example');
    const ragIndex = userMessage.indexOf('## Cross-Paper Context');
    const orderedHeaders = [
      { title: "## Researcher's Intuitions & Notes", index: memoIndex },
      { title: "## Researcher's Annotations", index: annotationIndex },
      { title: '## Paper: A Stable Prompt Example', index: fulltextIndex },
      { title: '## Cross-Paper Context', index: ragIndex },
    ]
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.title);

    expect({
      templateId: result.templateId,
      strategy: result.strategy,
      outputLanguageIncluded: result.systemPrompt.includes('中文'),
      orderedHeaders,
    }).toMatchInlineSnapshot(`
      {
        "orderedHeaders": [
          "## Researcher's Intuitions & Notes",
          "## Researcher's Annotations",
          "## Paper: A Stable Prompt Example",
          "## Cross-Paper Context",
        ],
        "outputLanguageIncluded": true,
        "strategy": "balanced",
        "templateId": "analyze-empirical",
      }
    `);

    expect(memoIndex).toBeLessThan(annotationIndex);
    expect(annotationIndex).toBeLessThan(fulltextIndex);
    expect(fulltextIndex).toBeLessThan(ragIndex);
  });

  it('preserves abstract and conclusion cues when fulltext is heavily compressed', () => {
    const result = assembler.assemble(makeRequest({
      allocation: makeAllocation({
        sourceAllocations: new Map([
          ['paper_fulltext', { budgetTokens: 80, priority: 'HIGH' as const }],
          ['rag_passages', { budgetTokens: 120, priority: 'MEDIUM' as const }],
          ['concept_framework', { budgetTokens: 200, priority: 'ABSOLUTE' as const }],
          ['researcher_memos', { budgetTokens: 120, priority: 'ABSOLUTE' as const }],
          ['researcher_annotations', { budgetTokens: 120, priority: 'ABSOLUTE' as const }],
        ]),
      }),
    }));

    expect(result.userMessage).toContain('# Abstract');
    expect(result.userMessage).toContain('## Conclusion');
    expect(result.userMessage).toContain('[...]');
  });
});