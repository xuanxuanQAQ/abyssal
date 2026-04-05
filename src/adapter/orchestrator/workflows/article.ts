/**
 * Article workflow — per-section academic writing with multi-source context.
 *
 * 14-step pipeline:
 * 1.  Outline context read (§3.2)
 * 2.  Memo + note collection with dedup (§3.3)
 * 3.  Five-path retrieval (§3.4)
 * 4.  Corrective RAG loop
 * 5.  CBM 7-source budget allocation (§3.5)
 * 6.  Prompt assembly
 * 7.  Paragraph protection injection (§4.4)
 * 8.  LLM call
 * 9.  Citation validation
 * 10. Paragraph protection verification (§4.5)
 * 11. Evidence sufficiency metadata write
 * 12. Section draft write (version + 1)
 * 13. Outline status update
 * 14. Preceding section summary generation (§3.6)
 *
 * See spec: §3-6
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowOptions, WorkflowRunnerContext } from '../workflow-runner';
import type { LlmClient } from '../../llm-client/llm-client';
import type { ContextBudgetManager } from '../../context-budget/context-budget-manager';
import type { Logger } from '../../../core/infra/logger';
import type { RankedChunk } from '../../../core/types/chunk';
import { formatMemos, formatEvidenceGaps, type MemoForFormat } from '../../prompt-assembler/section-formatter';
import { countTokens } from '../../llm-client/token-counter';
import { correctiveRagLoop, type LlmCallFn } from './corrective-rag/corrective-rag-loop';
import { hasEvidenceDeficiency, defaultPassReport, type QualityReport } from './corrective-rag/quality-report';
import { validateCitations } from './citation/citation-validator';
import { reverseExtractCitations } from './citation/citation-reverse-extractor';
import { buildProtectionBlock, verifyProtection } from './paragraph-protection/protection-verifier';
import { resetForNewVersion } from './paragraph-protection/edit-tracker';
import { generateSectionSummary, formatPrecedingContext } from './section-summary/deterministic-summary';
import { buildDocumentProjection, parseArticleDocument } from '../../../shared/writing/documentOutline';

const ARTICLE_STAGE_WORKFLOWS = {
  section: 'article.section',
  crag: 'article.crag',
} as const;

// ─── Services ───

export interface ArticleServices {
  dbProxy: {
    getMemosByEntity: (type: string, id: string) => Promise<Array<Record<string, unknown>>>;
    getPaper: (id: unknown) => Promise<Record<string, unknown> | null>;
    getOutlineEntry: (id: string) => Promise<Record<string, unknown> | null>;
    getArticle: (id: string) => Promise<Record<string, unknown> | null>;
    getOutline: (articleId: string) => Promise<Array<Record<string, unknown>>>;
    getSectionDrafts: (outlineEntryId: string) => Promise<Array<Record<string, unknown>>>;
    addSectionDraft: (outlineEntryId: string, content: string, llmBackend: string) => Promise<number>;
    getDraft: (draftId: string) => Promise<Record<string, unknown> | null>;
    getDraftSections: (draftId: string) => Promise<Array<Record<string, unknown>>>;
    getDraftDocument: (draftId: string) => Promise<{ draftId: string; articleId: string; documentJson: string; updatedAt: string }>;
    updateDraftSectionContent: (draftId: string, sectionId: string, content: string, documentJson?: string | null, source?: string) => Promise<void>;
    updateDraftSectionMeta: (draftId: string, sectionId: string, patch: Record<string, unknown>) => Promise<number>;
    markEditedParagraphs: (outlineEntryId: string, version: number, indices: number[]) => Promise<void>;
    updateOutlineEntry: (id: string, updates: Record<string, unknown>) => Promise<void>;
  };
  llmClient: LlmClient;
  contextBudgetManager: ContextBudgetManager;
  ragService: {
    retrieve: (request: Record<string, unknown>) => Promise<{ chunks: RankedChunk[]; totalTokenCount: number }>;
  } | null;
  logger: Logger;
  workspacePath: string;
  enableCorrectiveRag?: boolean;
}

// ─── Workflow ───

export function createArticleWorkflow(services: ArticleServices) {
  return async (options: WorkflowOptions, runner: WorkflowRunnerContext): Promise<void> => {
    const { dbProxy, logger } = services;
    const outlineEntryId = options.outlineEntryId;

    if (!outlineEntryId) {
      logger.warn('Article workflow: no outlineEntryId provided');
      return;
    }

    runner.setTotal(1);
    runner.reportProgress({ currentItem: outlineEntryId, currentStage: 'reading_outline' });

    try {
      await generateSection(outlineEntryId, (options as Record<string, unknown>)['draftId'] as string | undefined, services, runner);
      runner.reportComplete(outlineEntryId);
    } catch (error) {
      runner.reportFailed(outlineEntryId, 'article', error as Error);
    }
  };
}

async function generateSection(
  outlineEntryId: string,
  draftId: string | undefined,
  services: ArticleServices,
  runner: WorkflowRunnerContext,
): Promise<void> {
  const { dbProxy, llmClient, contextBudgetManager, logger, workspacePath } = services;
  const sectionWorkflowId = ARTICLE_STAGE_WORKFLOWS.section;
  const cragWorkflowId = ARTICLE_STAGE_WORKFLOWS.crag;
  const sectionModel = llmClient.resolveModel(sectionWorkflowId);

  // ══ Step 1: Outline context read (§3.2) ══
  let articleId = '';
  let article: Record<string, unknown> | null = null;
  let current = {
    title: '',
    thesis: '',
    writingInstruction: '',
    conceptIds: [] as string[],
    paperIds: [] as string[],
    seq: 0,
  };
  let precedingWithContent: Array<{ title: string; seq: number; content: string }> = [];
  let followingSections: Array<{ title: string; seq: number }> = [];
  let currentDraftContent = '';
  let editedParagraphs: number[] = [];
  let routeWritingStyle: string | null = null;

  if (draftId) {
    const draft = await dbProxy.getDraft(draftId);
    if (!draft) throw new Error(`Draft not found: ${draftId}`);
    routeWritingStyle = (draft['writingStyle'] as string ?? draft['writing_style'] as string) ?? null;

    articleId = (draft['articleId'] as string) ?? (draft['article_id'] as string) ?? '';
    article = await dbProxy.getArticle(articleId);
    if (!article) throw new Error(`Article not found: ${articleId}`);

    const draftSections = await dbProxy.getDraftSections(draftId);
    const currentIndex = draftSections.findIndex((section) => (section['sectionId'] as string ?? section['section_id'] as string) === outlineEntryId);
    if (currentIndex < 0) throw new Error(`Draft section not found: ${outlineEntryId}`);

    const activeSection = draftSections[currentIndex]!;
    current = {
      title: (activeSection['title'] as string) ?? '',
      thesis: '',
      writingInstruction: (activeSection['writingInstruction'] as string ?? activeSection['writing_instruction'] as string) ?? '',
      conceptIds: parseJsonArray(activeSection['conceptIds'] ?? activeSection['concept_ids']),
      paperIds: parseJsonArray(activeSection['paperIds'] ?? activeSection['paper_ids']),
      seq: currentIndex,
    };

    const draftDocument = await dbProxy.getDraftDocument(draftId);
    const projectedSections = buildDocumentProjection(parseArticleDocument(draftDocument.documentJson)).flatSections;
    const projectedMap = new Map(projectedSections.map((section) => [section.id, section]));

    precedingWithContent = draftSections
      .slice(0, currentIndex)
      .filter((section) => ((section['status'] as string) ?? 'pending') !== 'pending')
      .map((section, index) => {
        const sectionId = (section['sectionId'] as string ?? section['section_id'] as string) ?? '';
        const projected = projectedMap.get(sectionId);
        return {
          title: (section['title'] as string) ?? '',
          seq: index,
          content: projected?.plainText ?? '',
        };
      });

    followingSections = draftSections.slice(currentIndex + 1).map((section, index) => ({
      title: (section['title'] as string) ?? '',
      seq: currentIndex + index + 1,
    }));

    currentDraftContent = projectedMap.get(outlineEntryId)?.plainText ?? '';
  } else {
    const entry = await dbProxy.getOutlineEntry(outlineEntryId);
    if (!entry) throw new Error(`Outline entry not found: ${outlineEntryId}`);

    articleId = entry['articleId'] as string ?? entry['article_id'] as string;
    article = await dbProxy.getArticle(articleId);
    if (!article) throw new Error(`Article not found: ${articleId}`);

    current = {
      title: (entry['title'] as string) ?? '',
      thesis: (entry['coreArgument'] as string ?? entry['core_argument'] as string) ?? '',
      writingInstruction: (entry['writingInstruction'] as string ?? entry['writing_instruction'] as string) ?? '',
      conceptIds: parseJsonArray(entry['conceptIds'] ?? entry['concept_ids']),
      paperIds: parseJsonArray(entry['paperIds'] ?? entry['paper_ids']),
      seq: (entry['sortOrder'] as number ?? entry['sort_order'] as number) ?? 0,
    };

    const allOutlineEntries = await dbProxy.getOutline(articleId);

    const precedingSections = allOutlineEntries
      .filter((o) => {
        const seq = (o['sortOrder'] as number ?? o['sort_order'] as number) ?? 0;
        const status = (o['status'] as string) ?? 'pending';
        return seq < current.seq && status !== 'pending';
      })
      .sort((a, b) => ((a['sortOrder'] ?? a['sort_order']) as number) - ((b['sortOrder'] ?? b['sort_order']) as number));

    for (const ps of precedingSections) {
      const psId = (ps['id'] as string);
      let content = '';
      const drafts = await dbProxy.getSectionDrafts(psId);
      if (drafts.length > 0) {
        const latest = drafts.sort((a, b) => (b['version'] as number) - (a['version'] as number))[0]!;
        content = (latest['content'] as string) ?? '';
      }
      precedingWithContent.push({
        title: (ps['title'] as string) ?? '',
        seq: (ps['sortOrder'] as number ?? ps['sort_order'] as number) ?? 0,
        content,
      });
    }

    followingSections = allOutlineEntries
      .filter((o) => {
        const seq = (o['sortOrder'] as number ?? o['sort_order'] as number) ?? 0;
        return seq > current.seq;
      })
      .map((o) => ({
        title: (o['title'] as string) ?? '',
        seq: (o['sortOrder'] as number ?? o['sort_order'] as number) ?? 0,
      }));

    const drafts = await dbProxy.getSectionDrafts(outlineEntryId);
    if (drafts.length > 0) {
      const latest = drafts.sort((a, b) => (b['version'] as number) - (a['version'] as number))[0]!;
      currentDraftContent = (latest['content'] as string) ?? '';
      const rawEdited = latest['editedParagraphs'] ?? latest['edited_paragraphs'];
      editedParagraphs = (Array.isArray(rawEdited) ? rawEdited : parseJsonArray(rawEdited)).map(Number);
    }
  }

  if (!article) throw new Error(`Article not found: ${articleId}`);

  // ══ Step 2: Memo + note collection with dedup (§3.3) ══
  runner.reportProgress({ currentStage: 'collecting_notes' });
  const allMemos = new Map<string, Record<string, unknown>>();

  for (const conceptId of current.conceptIds) {
    const memos = await dbProxy.getMemosByEntity('concept', conceptId as string);
    for (const m of memos) allMemos.set((m['id'] as string), m);
  }
  for (const paperId of current.paperIds) {
    const memos = await dbProxy.getMemosByEntity('paper', paperId as string);
    for (const m of memos) allMemos.set((m['id'] as string), m);
  }
  const outlineMemos = await dbProxy.getMemosByEntity('outline', outlineEntryId);
  for (const m of outlineMemos) allMemos.set((m['id'] as string), m);

  const memosForPrompt: MemoForFormat[] = [...allMemos.values()]
    .sort((a, b) => ((a['createdAt'] ?? a['created_at']) as string ?? '').localeCompare((b['createdAt'] ?? b['created_at']) as string ?? ''))
    .map((m) => ({
      text: (m['text'] as string) ?? '',
      createdAt: (m['createdAt'] as string ?? m['created_at'] as string) ?? '',
      conceptIds: (m['conceptIds'] as string[] ?? m['concept_ids'] as string[]) ?? [],
      paperIds: (m['paperIds'] as string[] ?? m['paper_ids'] as string[]) ?? [],
    }));

  // ══ Step 3: Multi-source retrieval (§3.4) ══
  runner.reportProgress({ currentStage: 'retrieving' });

  let ragChunks: RankedChunk[] = [];
  let synthesisFragments = '';
  let qualityReport: QualityReport = defaultPassReport();

  // Path A: Load synthesis fragments
  for (const conceptId of current.conceptIds) {
    const draftPath = path.join(workspacePath, 'drafts', `${conceptId}.md`);
    if (fs.existsSync(draftPath)) {
      const content = fs.readFileSync(draftPath, 'utf-8');
      const cleaned = reverseExtractCitations(content);
      synthesisFragments += `### Concept: ${conceptId}\n${cleaned}\n\n`;
    }
  }

  // Path B: RAG retrieval
  if (services.ragService) {
    try {
      const result = await services.ragService.retrieve({
        queryText: current.thesis + ' ' + current.writingInstruction,
        taskType: 'article',
        conceptIds: current.conceptIds,
        paperIds: current.paperIds,
        budgetMode: 'focused',
        maxTokens: 30000,
        modelContextWindow: llmClient.getContextWindow('article'),
        enableCorrectiveRag: services.enableCorrectiveRag ?? true,
        sourceFilter: ['paper', 'memo', 'note'],
        relatedMemoIds: [],
        sectionTypeFilter: null,
      });
      ragChunks = result.chunks;
    } catch (err) {
      logger.warn(`Article section: RAG retrieval failed`, { error: (err as Error).message });
    }
  }

  // ══ Step 4: Corrective RAG loop ══
  if (services.enableCorrectiveRag !== false && ragChunks.length > 0 && services.ragService) {
    runner.reportProgress({ currentStage: 'crag_evaluation' });

    const llmCallFn: LlmCallFn = async (sys, user) => {
      const r = await llmClient.complete({
        systemPrompt: sys,
        messages: [{ role: 'user', content: user }],
        workflowId: cragWorkflowId,
      });
      return r.text;
    };

    const retrieveFn = async (query: string, opts: Record<string, unknown>) => {
      const r = await services.ragService!.retrieve({ ...opts, queryText: query });
      return r.chunks;
    };

    const cragResult = await correctiveRagLoop(
      ragChunks,
      current.thesis,
      `Write section '${current.title}' with thesis: '${current.thesis}'`,
      llmCallFn,
      retrieveFn,
      { retrievalOptions: { taskType: 'article', conceptIds: current.conceptIds, budgetMode: 'focused' }, enabled: true },
      logger,
    );
    ragChunks = cragResult.chunks;
    qualityReport = cragResult.qualityReport;
  }

  // Build known paper IDs for citation validation
  const knownPaperIds = new Set<string>();
  for (const pid of current.paperIds) knownPaperIds.add(pid as string);
  for (const c of ragChunks) { if (c.paperId) knownPaperIds.add(c.paperId); }

  // ══ Step 5: CBM 7-source budget allocation (§3.5) ══
  runner.reportProgress({ currentStage: 'budgeting' });
  const memoText = memosForPrompt.map((m) => m.text).join('\n');
  const ragBlock = ragChunks.map((c) => `${c.displayTitle ?? ''}\n${c.text}`).join('\n\n');
  const precedingBlock = formatPrecedingContext(precedingWithContent, followingSections);

  const allocation = contextBudgetManager.allocate({
    taskType: 'article',
    model: sectionModel,
    modelContextWindow: llmClient.getContextWindow(sectionWorkflowId),
    costPreference: 'balanced',
    sources: [
      { sourceType: 'writing_instruction' as const, estimatedTokens: countTokens(current.thesis + current.writingInstruction), priority: 'ABSOLUTE' as const, content: null },
      { sourceType: 'researcher_memos' as const, estimatedTokens: countTokens(memoText), priority: 'ABSOLUTE' as const, content: memoText },
      { sourceType: 'researcher_annotations' as const, estimatedTokens: 0, priority: 'ABSOLUTE' as const, content: null },
      { sourceType: 'synthesis_fragments' as const, estimatedTokens: countTokens(synthesisFragments), priority: 'HIGH' as const, content: synthesisFragments },
      { sourceType: 'rag_passages' as const, estimatedTokens: countTokens(ragBlock), priority: 'MEDIUM' as const, content: ragBlock },
      { sourceType: 'private_knowledge' as const, estimatedTokens: 0, priority: 'MEDIUM' as const, content: null },
      { sourceType: 'preceding_context' as const, estimatedTokens: countTokens(precedingBlock), priority: 'LOW' as const, content: precedingBlock },
    ],
    conceptMaturities: [],
  });

  // ══ Step 6: Prompt assembly ══
  runner.reportProgress({ currentStage: 'prompting' });

  // effectiveStyle: route (draft) style → article default style → system default
  const style = routeWritingStyle ?? (article['style'] as string) ?? 'formal_paper';
  const systemPrompt = buildArticleSystemPrompt(style, current, precedingBlock, followingSections);

  // ══ Step 7: Paragraph protection injection (§4.4) ══
  let protectionBlock = '';
  let protectedParagraphs: Array<{ index: number; content: string }> = [];

  if (editedParagraphs.length > 0 && currentDraftContent) {
    const protection = buildProtectionBlock(currentDraftContent, editedParagraphs);
    protectionBlock = protection.protectionBlock;
    protectedParagraphs = protection.protectedParagraphs;
  }

  // Evidence gaps from CRAG
  const evidenceGaps = qualityReport.gaps.map((g) => g.description);
  const gapsSection = hasEvidenceDeficiency(qualityReport)
    ? formatEvidenceGaps('this section', evidenceGaps)
    : '';

  const memoSection = formatMemos(memosForPrompt);

  const userContent = [
    memoSection,
    synthesisFragments ? `## Literature Synthesis Fragments\n\n${synthesisFragments}` : '',
    ragBlock ? `## Retrieved Paper Passages\n\n${ragBlock}` : '',
    gapsSection,
  ].filter(Boolean).join('\n\n');

  const fullSystemPrompt = [
    systemPrompt,
    protectionBlock,
  ].filter(Boolean).join('\n\n');

  // ══ Step 8: LLM call ══
  runner.reportProgress({ currentStage: 'writing' });

  const result = await llmClient.complete({
    systemPrompt: fullSystemPrompt,
    messages: [{ role: 'user', content: userContent }],
    workflowId: sectionWorkflowId,
  });

  // ══ Step 9: Citation validation ══
  const validated = validateCitations(result.text, knownPaperIds);
  if (validated.invalidCount > 0) {
    logger.warn(`Article section: ${validated.invalidCount} invalid citations`);
  }

  // ══ Step 10: Paragraph protection verification (§4.5) ══
  let finalContent = validated.text;
  let restoredIndices: number[] = [];

  if (protectedParagraphs.length > 0) {
    const verification = verifyProtection(validated.text, protectedParagraphs);
    finalContent = verification.content;

    if (verification.restored) {
      logger.warn(`Article section: ${verification.violations.length} protected paragraphs force-restored`);
      restoredIndices = protectedParagraphs.map((p) => p.index);
    }
  }

  // ══ Step 11: Evidence sufficiency metadata ══
  // QualityReport is persisted alongside the draft for UI display

  // ══ Step 12: Section draft write (version + 1) ══
  if (draftId) {
    await dbProxy.updateDraftSectionContent(draftId, outlineEntryId, finalContent, null, 'ai-generate');
    await dbProxy.updateDraftSectionMeta(draftId, outlineEntryId, {
      status: 'drafted',
      aiModel: result.model,
      evidenceStatus: hasEvidenceDeficiency(qualityReport) ? 'insufficient' : 'sufficient',
      evidenceGaps,
    });
  } else {
    const version = await dbProxy.addSectionDraft(outlineEntryId, finalContent, result.model);

    const newEditedParagraphs = resetForNewVersion(restoredIndices.length > 0 ? restoredIndices : undefined);
    if (newEditedParagraphs.length > 0) {
      await dbProxy.markEditedParagraphs(outlineEntryId, version, newEditedParagraphs);
    }
  }

  // Write quality report
  if (hasEvidenceDeficiency(qualityReport)) {
    const reportDir = path.join(workspacePath, 'articles');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, `${outlineEntryId}.quality.json`),
      JSON.stringify(qualityReport, null, 2),
      'utf-8',
    );
  }

  // ══ Step 13: Outline status update ══
  if (!draftId) {
    await dbProxy.updateOutlineEntry(outlineEntryId, { status: 'drafted' });
  }

  // ══ Step 14: Preceding section summary (§3.6) ══
  // Summary is generated deterministically when needed by the next section.
  // No action required here — formatPrecedingContext handles it on demand.
}

// ─── Helpers ───

function buildArticleSystemPrompt(
  style: string,
  current: { title: string; thesis: string; writingInstruction: string; conceptIds: unknown[]; paperIds: unknown[] },
  precedingContext: string,
  followingSections: Array<{ title: string; seq: number }>,
): string {
  let prompt = `You are an academic writing assistant specializing in ${style.replace(/_/g, ' ')} writing.

## Current Section
Title: ${current.title}
Core Thesis: ${current.thesis}
Writing Instruction: ${current.writingInstruction}`;

  if (precedingContext) {
    prompt += `\n\n## Article Structure Context\n${precedingContext}`;
  }

  prompt += `\n\n## Output Format
Write in Markdown. Use [@paper_id] to cite papers from the provided context.
Do not cite papers not provided. Include section headings as appropriate.
Target length: 800-1500 words.`;

  return prompt;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}
