/**
 * Synthesize workflow — per-concept literature review generation.
 *
 * 10-step pipeline:
 * 1.  Concept & mapping read (§2.2)
 * 2.  Memo & note collection
 * 3.  Broad Context RAG retrieval
 * 4.  Corrective RAG loop (§1)
 * 5.  Adjudication history formatting (§2.3)
 * 6.  CBM budget allocation
 * 7.  Prompt assembly (§2.4)
 * 8.  LLM call
 * 9.  Citation validation + preformatting (§2.5)
 * 10. Draft write (idempotent overwrite)
 *
 * See spec: §2
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { LlmClient } from '../../llm-client/llm-client';
import { streamingComplete } from './streaming-llm-helper';
import type { ContextBudgetManager } from '../../context-budget/context-budget-manager';
import type { Logger } from '../../../core/infra/logger';
import type { RankedChunk } from '../../../core/types/chunk';
import {
  formatConceptFramework,
  formatMemos,
  formatAdjudicationHistory,
  formatEvidenceGaps,
  type ConceptForFormat,
  type MemoForFormat,
  type AdjudicationForFormat,
} from '../../prompt-assembler/section-formatter';
import { countTokens } from '../../llm-client/token-counter';
import { correctiveRagLoop, type LlmCallFn } from './corrective-rag/corrective-rag-loop';
import { hasEvidenceDeficiency, defaultPassReport, type QualityReport } from './corrective-rag/quality-report';
import { validateCitations } from './citation/citation-validator';
import { preformatCitations, type CitationFormatter } from './citation/citation-preformatter';
import { classifyError } from '../error-classifier';
import { resolveCurrentRagService } from './rag-service-resolver';

const SYNTHESIZE_STAGE_WORKFLOWS = {
  draft: 'synthesize.draft',
  crag: 'synthesize.crag',
} as const;

// ─── Services ───

export interface SynthesizeServices {
  dbProxy: {
    getConcept: (id: unknown) => Promise<Record<string, unknown> | null>;
    getMappingsByConcept: (conceptId: unknown) => Promise<Array<Record<string, unknown>>>;
    getMemosByEntity: (type: string, id: string) => Promise<Array<Record<string, unknown>>>;
    getAllNotes: () => Promise<Array<Record<string, unknown>>>;
    getPaper: (id: unknown) => Promise<Record<string, unknown> | null>;
  };
  llmClient: LlmClient;
  contextBudgetManager: ContextBudgetManager;
  ragService: {
    retrieve: (request: Record<string, unknown>) => Promise<{ chunks: RankedChunk[]; totalTokenCount: number }>;
  } | null;
  getRagService?: (() => SynthesizeServices['ragService']) | undefined;
  cslEngine?: {
    formatCitation: (papers: Array<{ paperId: string; metadata: Record<string, unknown> }>) => Array<{ inlineCitation: string }>;
  } | null;
  logger: Logger;
  workspacePath: string;
  enableCorrectiveRag?: boolean;
}

// ─── Workflow ───

export function createSynthesizeWorkflow(services: SynthesizeServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath } = services;

    const conceptIds = options.conceptIds ?? [];
    runner.setTotal(conceptIds.length);
    if (conceptIds.length === 0) return;

    for (const conceptId of conceptIds) {
      if (runner.signal.aborted) break;
      runner.reportProgress({ currentItem: conceptId, currentStage: 'reading_concept' });

      try {
        await synthesizeConcept(conceptId, {
          dbProxy, llmClient, contextBudgetManager, logger, workspacePath,
          ragService: resolveCurrentRagService(services),
          cslEngine: services.cslEngine ?? null,
          enableCorrectiveRag: services.enableCorrectiveRag ?? true,
          runner,
        });
        runner.reportComplete(conceptId);
      } catch (error) {
        const classified = classifyError(error);
        logger.error(`[synthesize] Concept ${conceptId} failed`, error as Error, {
          category: classified.category,
          retryable: classified.retryable,
        });
        runner.reportFailed(conceptId, 'synthesize', error as Error);
      }
    }
  };
}

async function synthesizeConcept(
  conceptId: string,
  ctx: {
    dbProxy: SynthesizeServices['dbProxy'];
    llmClient: LlmClient;
    contextBudgetManager: ContextBudgetManager;
    ragService: SynthesizeServices['ragService'];
    cslEngine: SynthesizeServices['cslEngine'];
    logger: Logger;
    workspacePath: string;
    enableCorrectiveRag: boolean;
    runner: WorkflowRunnerContext;
  },
): Promise<void> {
  const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath, runner } = ctx;
  const draftWorkflowId = SYNTHESIZE_STAGE_WORKFLOWS.draft;
  const cragWorkflowId = SYNTHESIZE_STAGE_WORKFLOWS.crag;
  const draftModel = llmClient.resolveModel(draftWorkflowId);

  // ── Substep tracking for UI timeline ──
  const SYNTH_SUBSTEPS = ['collecting_notes', 'retrieving', 'crag_evaluation', 'budgeting', 'synthesizing', 'citations', 'writing'] as const;
  type SynthSubstep = typeof SYNTH_SUBSTEPS[number];
  const substepStatus = new Map<string, 'pending' | 'running' | 'success' | 'failed' | 'skipped'>(
    SYNTH_SUBSTEPS.map((s) => [s, 'pending']),
  );
  const updateSubstep = (name: SynthSubstep, status: 'running' | 'success' | 'failed' | 'skipped') => {
    substepStatus.set(name, status);
    runner.reportProgress({
      substeps: SYNTH_SUBSTEPS.map((s) => ({ name: s, status: substepStatus.get(s) ?? 'pending' })),
    });
  };

  // ══ Step 1: Concept & mappings (§2.2) ══
  const concept = await dbProxy.getConcept(conceptId);
  if (!concept) { runner.reportSkipped(conceptId); return; }

  const deprecated = concept['deprecated'] === true || concept['deprecated'] === 1;
  if (deprecated) {
    logger.warn(`Concept ${conceptId} is deprecated, skipping synthesis`);
    runner.reportSkipped(conceptId);
    return;
  }

  // Report human-readable concept name for UI
  const conceptLabel = (concept['nameEn'] as string) ?? (concept['nameZh'] as string) ?? conceptId;
  runner.reportProgress({ currentItemLabel: conceptLabel });

  const mappings = await dbProxy.getMappingsByConcept(conceptId);
  const filteredMappings = mappings.filter((m) => {
    const relation = m['relation'] as string;
    const confidence = m['confidence'] as number;
    return relation !== 'irrelevant' && confidence >= 0.3;
  });

  if (filteredMappings.length < 2) {
    logger.warn(`Concept ${conceptId}: only ${filteredMappings.length} mappings, evidence insufficient`);
    // Continue anyway — will be noted in output
  }

  const conceptName = (concept['nameEn'] as string) ?? conceptId;
  const conceptDef = (concept['definition'] as string) ?? '';
  const maturity = (concept['maturity'] as 'tentative' | 'working' | 'established') ?? 'working';

  // ══ Step 2: Memos & notes ══
  runner.reportProgress({ currentStage: 'collecting_notes' });
  updateSubstep('collecting_notes', 'running');
  const memos = await dbProxy.getMemosByEntity('concept', conceptId);
  const memosForPrompt: MemoForFormat[] = memos.map((m) => ({
    text: (m['text'] as string) ?? '',
    createdAt: (m['createdAt'] as string) ?? '',
    conceptIds: (m['conceptIds'] as string[]) ?? [],
    paperIds: (m['paperIds'] as string[]) ?? [],
  }));

  // ══ Step 3: Broad Context RAG retrieval ══
  updateSubstep('collecting_notes', 'success');
  runner.reportProgress({ currentStage: 'retrieving' });
  updateSubstep('retrieving', 'running');
  let ragChunks: RankedChunk[] = [];
  let qualityReport: QualityReport = defaultPassReport();

  if (ctx.ragService) {
    try {
      const retrievalResult = await ctx.ragService.retrieve({
        queryText: `${conceptName}: ${conceptDef}`,
        taskType: 'synthesize',
        conceptIds: [conceptId],
        paperIds: [],
        budgetMode: 'broad',
        maxTokens: 50000,
        modelContextWindow: llmClient.getContextWindow('synthesize'),
        enableCorrectiveRag: ctx.enableCorrectiveRag,
        sourceFilter: ['paper', 'annotation', 'memo'],
        relatedMemoIds: [],
        sectionTypeFilter: null,
      });
      ragChunks = retrievalResult.chunks;
    } catch (err) {
      logger.warn(`Concept ${conceptId}: RAG retrieval failed, proceeding without`, { error: (err as Error).message });
    }
  }

  // ══ Step 4: Corrective RAG loop (§1) ══
  if (ctx.enableCorrectiveRag && ragChunks.length > 0 && ctx.ragService) {
    updateSubstep('retrieving', 'success');
    runner.reportProgress({ currentStage: 'crag_evaluation' });
    updateSubstep('crag_evaluation', 'running');

    const llmCallFn: LlmCallFn = async (sys, user) => {
      const r = await llmClient.complete({
        systemPrompt: sys,
        messages: [{ role: 'user', content: user }],
        workflowId: cragWorkflowId,
      });
      return r.text;
    };

    const retrieveFn = async (query: string, opts: Record<string, unknown>) => {
      const r = await ctx.ragService!.retrieve({ ...opts, queryText: query });
      return r.chunks;
    };

    const cragResult = await correctiveRagLoop(
      ragChunks,
      `${conceptName}: ${conceptDef}`,
      `Generate a literature review for concept '${conceptName}': ${conceptDef}`,
      llmCallFn,
      retrieveFn,
      { retrievalOptions: { taskType: 'synthesize', conceptIds: [conceptId], budgetMode: 'broad', maxTokens: 50000 }, enabled: true },
      logger,
    );

    ragChunks = cragResult.chunks;
    qualityReport = cragResult.qualityReport;
  }

  // Format RAG passages
  const ragBlock = formatRagPassagesForSynthesize(ragChunks);

  // ══ Step 5: Adjudication history (§2.3) ══
  const adjudicationEntries: AdjudicationForFormat[] = [];
  const reviewedMappings = filteredMappings.filter((m) => m['reviewed'] === 1 || m['reviewed'] === true);
  const knownPaperIds = new Set<string>();

  for (const m of reviewedMappings) {
    const paperId = m['paperId'] as string;
    const paper = await dbProxy.getPaper(paperId);
    if (!paper) continue;
    knownPaperIds.add(paperId);

    adjudicationEntries.push({
      paperId,
      paperTitle: (paper['title'] as string) ?? '',
      paperYear: (paper['year'] as number) ?? 0,
      relation: (m['relation'] as string) ?? '',
      confidence: (m['confidence'] as number) ?? 0,
      decision: 'accepted',
      decisionNote: (m['decisionNote'] as string | null) ?? null,
    });
  }

  // Also add unreviewed paper IDs for citation validation
  for (const m of filteredMappings) {
    const paperId = m['paperId'] as string;
    knownPaperIds.add(paperId);
  }
  // Add paper IDs from RAG chunks
  for (const c of ragChunks) {
    if (c.paperId) knownPaperIds.add(c.paperId);
  }

  // ══ Step 6: CBM budget allocation ══
  updateSubstep('crag_evaluation', 'success');
  runner.reportProgress({ currentStage: 'budgeting' });
  updateSubstep('budgeting', 'running');
  const memoText = memosForPrompt.map((m) => m.text).join('\n');

  const _allocation = contextBudgetManager.allocate({
    taskType: 'synthesize',
    model: draftModel,
    modelContextWindow: llmClient.getContextWindow(draftWorkflowId),
    costPreference: 'balanced',
    sources: [
      { sourceType: 'concept_framework' as const, estimatedTokens: 500, priority: 'ABSOLUTE' as const, content: null },
      { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memoText), priority: 'ABSOLUTE' as const, content: memoText },
      { sourceType: 'researcher_annotations' as const, estimatedTokens: countTokens(adjudicationEntries.length > 0 ? '...' : ''), priority: 'ABSOLUTE' as const, content: null },
      { sourceType: 'rag_passages' as const, estimatedTokens: countTokens(ragBlock), priority: 'HIGH' as const, content: ragBlock },
    ],
    conceptMaturities: [maturity],
  });

  // ══ Step 7: Prompt assembly (§2.4) ══
  runner.reportProgress({ currentStage: 'prompting' });

  const conceptForFormat: ConceptForFormat = {
    id: conceptId,
    nameEn: conceptName,
    nameZh: (concept['nameZh'] as string) ?? '',
    definition: conceptDef,
    searchKeywords: (concept['searchKeywords'] as string[]) ?? [],
    maturity,
  };

  const systemPrompt = buildSynthesizeSystemPrompt(conceptName, maturity);
  const conceptSection = formatConceptFramework([conceptForFormat]);
  const memoSection = formatMemos(memosForPrompt);
  const adjudicationSection = formatAdjudicationHistory(conceptName, adjudicationEntries);

  // Evidence gaps from CRAG (§1.7-1.8)
  const evidenceGaps = qualityReport.gaps.map((g) => g.description);
  const gapsSection = hasEvidenceDeficiency(qualityReport)
    ? formatEvidenceGaps(conceptName, evidenceGaps)
    : '';

  const userContent = [
    conceptSection,
    memoSection,
    adjudicationSection,
    ragBlock ? `## Retrieved Paper Passages\n\n${ragBlock}` : '',
    gapsSection,
  ].filter(Boolean).join('\n\n---\n\n');

  // ══ Step 8: LLM call ══
  updateSubstep('budgeting', 'success');
  runner.reportProgress({ currentStage: 'synthesizing' });
  updateSubstep('synthesizing', 'running');
  const result = await streamingComplete(llmClient, {
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    workflowId: draftWorkflowId,
  }, runner);

  // ══ Step 9: Citation validation + preformatting (§2.5) ══
  updateSubstep('synthesizing', 'success');
  runner.reportProgress({ currentStage: 'citations' });
  updateSubstep('citations', 'running');
  const validated = validateCitations(result.text, knownPaperIds);

  if (validated.invalidCount > 0) {
    logger.warn(`Concept ${conceptId}: ${validated.invalidCount} invalid citations in synthesis`);
  }

  // Preformat citations to dual-preserve format [[@id]](rendered)
  // Build CSL formatter if engine is available
  let cslFormatter: CitationFormatter | null = null;
  if (ctx.cslEngine && knownPaperIds.size > 0) {
    const paperMetaCache = new Map<string, Record<string, unknown>>();
    for (const pid of knownPaperIds) {
      const p = await dbProxy.getPaper(pid);
      if (p) paperMetaCache.set(pid, p);
    }
    cslFormatter = {
      formatInline: (paperId: string) => {
        const meta = paperMetaCache.get(paperId);
        if (!meta) return null;
        const results = ctx.cslEngine!.formatCitation([{ paperId, metadata: meta }]);
        return results[0]?.inlineCitation ?? null;
      },
      formatCluster: (paperIds: string[]) => {
        const papers = paperIds
          .filter((id) => paperMetaCache.has(id))
          .map((id) => ({ paperId: id, metadata: paperMetaCache.get(id)! }));
        if (papers.length === 0) return null;
        const results = ctx.cslEngine!.formatCitation(papers);
        return results.map((r) => r.inlineCitation).join('; ') || null;
      },
    };
  }
  const preformatted = preformatCitations(validated.text, cslFormatter);

  // ══ Step 10: Draft write (idempotent overwrite) ══
  updateSubstep('citations', 'success');
  runner.reportProgress({ currentStage: 'writing' });
  updateSubstep('writing', 'running');
  const draftDir = path.join(workspacePath, 'drafts');
  fs.mkdirSync(draftDir, { recursive: true });

  const draftPath = path.join(draftDir, `${conceptId}.md`);
  const tmpPath = draftPath + '.tmp';
  fs.writeFileSync(tmpPath, preformatted.text, 'utf-8');
  fs.renameSync(tmpPath, draftPath);

  // Write quality report metadata
  if (qualityReport.retryCount > 0 || hasEvidenceDeficiency(qualityReport)) {
    const reportPath = path.join(draftDir, `${conceptId}.quality.json`);
    fs.writeFileSync(reportPath, JSON.stringify(qualityReport, null, 2), 'utf-8');
  }
  updateSubstep('writing', 'success');
}

// ─── Helpers ───

function buildSynthesizeSystemPrompt(conceptName: string, maturity: string): string {
  let prompt = `You are writing a focused literature review synthesis for the concept "${conceptName}".

Synthesize the evidence from the retrieved passages, respecting the researcher's judgments.
Use citation markers [@paper_id] to reference specific papers.
Structure your synthesis as a coherent narrative, not a paper-by-paper summary.
Cover ALL 'supports' and 'challenges' papers. Contradictory evidence MUST be explicitly acknowledged.
Acknowledge evidence gaps honestly.

Output in Markdown format, 500-800 words.`;

  if (maturity === 'tentative') {
    prompt += `\n\nNote: This concept is tentative. Acknowledge the exploratory nature of this framing in your synthesis.`;
  }

  return prompt;
}

function formatRagPassagesForSynthesize(chunks: RankedChunk[]): string {
  if (chunks.length === 0) return '';

  // Group by paper
  const byPaper = new Map<string, RankedChunk[]>();
  for (const c of chunks) {
    const paperId = c.paperId ?? 'unknown';
    const existing = byPaper.get(paperId) ?? [];
    existing.push(c);
    byPaper.set(paperId, existing);
  }

  const lines: string[] = [];
  for (const [paperId, paperChunks] of byPaper) {
    const title = paperChunks[0]?.displayTitle ?? paperId;
    lines.push(`### From: ${title}`);
    for (const chunk of paperChunks) {
      const section = chunk.sectionTitle ?? chunk.sectionType ?? '';
      if (section) lines.push(`_Section: ${section}_`);
      lines.push(chunk.text);
      lines.push('');
    }
  }

  return lines.join('\n');
}
