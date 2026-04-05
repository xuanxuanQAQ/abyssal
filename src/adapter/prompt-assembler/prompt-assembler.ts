/**
 * Prompt Assembler — seven-stage assembly pipeline for LLM prompts.
 *
 * Stage 1: Template loading (§11)
 * Stage 2: Fixed region rendering (preamble + output instructions)
 * Stage 3: ABSOLUTE region rendering (never trimmed)
 * Stage 4: Trimmable region rendering (subject to budget constraints)
 * Stage 5: Final prompt assembly (system + user)
 * Stage 6: Token verification + iterative trimming (§5.3)
 * Stage 7: Return value construction with metadata
 *
 * See spec: §5.1
 */

import type { SourceType, SourcePriority } from '../context-budget/source-priority';
import type { BudgetAllocation } from '../context-budget/context-budget-manager';
import {
  loadTemplate,
  injectVariables,
  selectAnalyzeTemplate,
  buildYamlExample,
  type TemplateVariables,
  type TemplateId,
  type ArticleTemplateId,
} from './template-loader';
import { loadFile as loadFragment } from './variable-injector';
import {
  formatSectionBlock,
  formatAnnotations,
  formatMemos,
  formatConceptFramework,
  formatRagPassages,
  formatAdjudicationHistory,
  formatEvidenceGaps,
  formatProtectedParagraphs,
  type AnnotationForFormat,
  type MemoForFormat,
  type ConceptForFormat,
  type RagPassageForFormat,
  type AdjudicationForFormat,
} from './section-formatter';
import {
  truncateContent,
  iterativeTrim,
  type TokenCounter,
  type TrimBlock,
} from './truncation-engine';

// §8: Compact mode
import { shouldUseCompactMode, compactConceptFormat, compactMemos, compactAnnotations } from './compact-mode';

// ─── Types ───

export type FrameworkState = 'zero_concepts' | 'early_exploration' | 'framework_forming' | 'framework_mature';

export interface SourceInput {
  sourceType: SourceType;
  priority: SourcePriority;
  content: string;
  budgetTokens: number;
}

export interface AssemblyRequest {
  taskType: 'analyze' | 'synthesize' | 'article';
  allocation: BudgetAllocation;
  frameworkState: FrameworkState;
  paperId: string;
  paperType: string;
  paperTitle: string;
  projectName?: string;

  // Content sources
  conceptFramework: ConceptForFormat[];
  memos: MemoForFormat[];
  annotations: AnnotationForFormat[];
  paperContent: string;
  ragPassages: RagPassageForFormat[];

  // Optional sources
  adjudication?: { conceptName: string; entries: AdjudicationForFormat[] };
  evidenceGaps?: { conceptName: string; gaps: string[] };
  protectedParagraphs?: { content: string; editedIndices: number[] };
  synthesisFragments?: string;
  privateKnowledge?: string;
  precedingContext?: string;
  writingInstruction?: string;

  // §1.2: Extended fields
  conceptId?: string;
  articleStyle?: string;
  qualityReport?: { coverage?: string; sufficiency?: string };
  sectionMap?: Array<{ sectionType: string; title: string; startOffset: number; endOffset: number }>;

  /** Language for LLM output (e.g. "English", "中文"). Injected as {output_language} in templates. */
  outputLanguage?: string | undefined;
}

export interface AssemblyResult {
  systemPrompt: string;
  userMessage: string;
  estimatedInputTokens: number;
  estimatedOutputReserve: number;
  truncated: boolean;
  truncationDetails: Array<{ sourceType: string; originalTokens: number; truncatedTo: number }>;
  injectedMemoCount: number;
  injectedAnnotationCount: number;
  conceptSubsetSize: number;
  strategy: string;
  templateId: string;
  /** @deprecated use estimatedInputTokens */
  estimatedTokens: number;
}

// ─── Logger interface ───

interface AssemblerLogger {
  debug?: (msg: string, ctx?: Record<string, unknown>) => void;
}

// ─── Prompt Assembler ───

export class PromptAssembler {
  private readonly tokenCounter: TokenCounter;
  private readonly logger: AssemblerLogger | undefined;

  constructor(tokenCounter: TokenCounter, logger?: AssemblerLogger) {
    this.tokenCounter = tokenCounter;
    this.logger = logger ?? undefined;
  }

  /**
   * Assemble a complete prompt from budget allocation, raw sources, and template.
   *
   * Seven-stage pipeline (§5.1):
   * 1. Template load  2. Fixed render  3. ABSOLUTE render
   * 4. Trimmable render  5. Assemble  6. Verify + trim  7. Return
   */
  assemble(request: AssemblyRequest): AssemblyResult {
    const { taskType, allocation, frameworkState, paperId, paperType } = request;

    // ── Stage 1: Template loading ──
    let templateId: TemplateId;
    if (taskType === 'analyze') {
      templateId = selectAnalyzeTemplate(frameworkState, paperType);
    } else if (taskType === 'synthesize') {
      templateId = 'synthesize';
    } else {
      const articleStyleKey = request.articleStyle ?? 'formal_paper';
      const candidateId = `article-${articleStyleKey}` as ArticleTemplateId;
      const VALID_ARTICLE_TEMPLATES: Set<string> = new Set<string>([
        'article-academic_blog',
        'article-formal_paper',
        'article-technical_doc',
        'article-narrative_review',
        'article-policy_brief',
      ]);
      templateId = VALID_ARTICLE_TEMPLATES.has(candidateId) ? candidateId : 'article-formal_paper';
    }

    const rawTemplate = loadTemplate(templateId);

    // ── Stage 2: Fixed region rendering (always included) ──
    const systemPreamble = this.buildSystemPreamble(taskType, frameworkState);
    const outputInstructions = this.buildOutputInstructions(taskType, paperId);

    // ── Stage 3: ABSOLUTE region rendering (§3) ──
    const absoluteBlocks: Array<{ content: string; placement: 'system' | 'user'; sourceType: SourceType }> = [];

    // Concept framework (ABSOLUTE for analyze/synthesize, system prompt placement)
    if (frameworkState !== 'zero_concepts' && request.conceptFramework.length > 0) {
      const cfContent = formatConceptFramework(request.conceptFramework);
      if (cfContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            'Concept Framework',
            cfContent,
            'concept_framework',
            'ABSOLUTE',
            this.tokenCounter.count(cfContent),
          ),
          placement: 'system',
          sourceType: 'concept_framework',
        });
      }
    }

    // Researcher memos (ABSOLUTE, user message placement)
    if (request.memos.length > 0) {
      const memoContent = formatMemos(request.memos, paperId);
      if (memoContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            "Researcher's Intuitions & Notes",
            memoContent,
            'researcher_memos',
            'ABSOLUTE',
            this.tokenCounter.count(memoContent),
          ),
          placement: 'user',
          sourceType: 'researcher_memos',
        });
      }
    }

    // Researcher annotations (ABSOLUTE, user message placement)
    if (request.annotations.length > 0) {
      const annotationContent = formatAnnotations(request.annotations);
      if (annotationContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            "Researcher's Annotations",
            annotationContent,
            'researcher_annotations',
            'ABSOLUTE',
            this.tokenCounter.count(annotationContent),
          ),
          placement: 'user',
          sourceType: 'researcher_annotations',
        });
      }
    }

    // Writing instruction (ABSOLUTE for article workflow)
    if (taskType === 'article' && request.writingInstruction) {
      absoluteBlocks.push({
        content: formatSectionBlock(
          'Writing Instructions',
          request.writingInstruction,
          'writing_instruction',
          'ABSOLUTE',
          this.tokenCounter.count(request.writingInstruction),
        ),
        placement: 'system',
        sourceType: 'writing_instruction',
      });
    }

    // Adjudication history (ABSOLUTE for synthesize)
    if (request.adjudication && request.adjudication.entries.length > 0) {
      const adjContent = formatAdjudicationHistory(
        request.adjudication.conceptName,
        request.adjudication.entries,
      );
      if (adjContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            `Researcher's Judgments on Concept "${request.adjudication.conceptName}"`,
            adjContent,
            'researcher_annotations', // reuses annotation source type for priority
            'ABSOLUTE',
            this.tokenCounter.count(adjContent),
          ),
          placement: 'system',
          sourceType: 'researcher_annotations',
        });
      }
    }

    // Evidence gaps (ABSOLUTE for synthesize)
    if (request.evidenceGaps && request.evidenceGaps.gaps.length > 0) {
      const gapContent = formatEvidenceGaps(
        request.evidenceGaps.conceptName,
        request.evidenceGaps.gaps,
      );
      if (gapContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            'Evidence Limitation Notice',
            gapContent,
            'researcher_annotations',
            'ABSOLUTE',
            this.tokenCounter.count(gapContent),
          ),
          placement: 'system',
          sourceType: 'researcher_annotations',
        });
      }
    }

    // ── Stage 4: Trimmable region rendering ──
    const trimmedBlocks: TrimBlock[] = [];

    // Paper fulltext (HIGH for analyze)
    if (request.paperContent) {
      const fulltextBudget =
        allocation.sourceAllocations.get('paper_fulltext')?.budgetTokens ?? 30_000;
      const truncatedFulltext = truncateContent(
        request.paperContent,
        fulltextBudget,
        'paper_fulltext',
        this.tokenCounter,
      );
      const block = formatSectionBlock(
        `Paper: ${request.paperTitle}`,
        truncatedFulltext,
        'paper_fulltext',
        'HIGH',
        this.tokenCounter.count(truncatedFulltext),
      );
      trimmedBlocks.push({
        content: block,
        sourceType: 'paper_fulltext',
        priority: 'HIGH',
        included: true,
      });
    }

    // RAG passages (MEDIUM/HIGH depending on task)
    if (request.ragPassages.length > 0) {
      const ragBudget =
        allocation.sourceAllocations.get('rag_passages')?.budgetTokens ?? 8_000;
      const ragContent = formatRagPassages(request.ragPassages);
      const truncatedRag = truncateContent(
        ragContent,
        ragBudget,
        'rag_passages',
        this.tokenCounter,
      );
      const ragPriority = taskType === 'synthesize' ? 'HIGH' : 'MEDIUM';
      const block = formatSectionBlock(
        'Cross-Paper Context',
        truncatedRag,
        'rag_passages',
        ragPriority as SourcePriority,
        this.tokenCounter.count(truncatedRag),
      );
      trimmedBlocks.push({
        content: block,
        sourceType: 'rag_passages',
        priority: ragPriority as SourcePriority,
        included: true,
      });
    }

    // Synthesis fragments (HIGH for article)
    if (request.synthesisFragments) {
      const fragBudget =
        allocation.sourceAllocations.get('synthesis_fragments')?.budgetTokens ?? 10_000;
      const truncatedFrags = truncateContent(
        request.synthesisFragments,
        fragBudget,
        'synthesis_fragments',
        this.tokenCounter,
      );
      const block = formatSectionBlock(
        'Synthesis Fragments',
        truncatedFrags,
        'synthesis_fragments',
        'HIGH',
        this.tokenCounter.count(truncatedFrags),
      );
      trimmedBlocks.push({
        content: block,
        sourceType: 'synthesis_fragments',
        priority: 'HIGH',
        included: true,
      });
    }

    // Private knowledge (MEDIUM for article)
    if (request.privateKnowledge) {
      const pkBudget =
        allocation.sourceAllocations.get('private_knowledge')?.budgetTokens ?? 5_000;
      const truncatedPk = truncateContent(
        request.privateKnowledge,
        pkBudget,
        'private_knowledge',
        this.tokenCounter,
      );
      const block = formatSectionBlock(
        'Private Knowledge Base',
        truncatedPk,
        'private_knowledge',
        'MEDIUM',
        this.tokenCounter.count(truncatedPk),
      );
      trimmedBlocks.push({
        content: block,
        sourceType: 'private_knowledge',
        priority: 'MEDIUM',
        included: true,
      });
    }

    // Preceding context (LOW for article/synthesize)
    if (request.precedingContext) {
      const pcBudget =
        allocation.sourceAllocations.get('preceding_context')?.budgetTokens ?? 5_000;
      const truncatedPc = truncateContent(
        request.precedingContext,
        pcBudget,
        'preceding_context',
        this.tokenCounter,
      );
      const block = formatSectionBlock(
        'Preceding Sections',
        truncatedPc,
        'preceding_context',
        'LOW',
        this.tokenCounter.count(truncatedPc),
      );
      trimmedBlocks.push({
        content: block,
        sourceType: 'preceding_context',
        priority: 'LOW',
        included: true,
      });
    }

    // Protected paragraphs (article only)
    if (request.protectedParagraphs && request.protectedParagraphs.editedIndices.length > 0) {
      const ppContent = formatProtectedParagraphs(
        request.protectedParagraphs.content,
        request.protectedParagraphs.editedIndices,
      );
      if (ppContent) {
        absoluteBlocks.push({
          content: formatSectionBlock(
            'Protected Paragraphs',
            ppContent,
            'writing_instruction',
            'ABSOLUTE',
            this.tokenCounter.count(ppContent),
          ),
          placement: 'system',
          sourceType: 'writing_instruction',
        });
      }
    }

    // ── Stage 5: Assemble final prompt ──

    // Inject template variables if template was loaded
    let renderedTemplate = '';
    if (rawTemplate) {
      const vars: TemplateVariables = {
        paper_id: paperId,
        paper_type: paperType,
        project_name: request.projectName ?? '',
        concept_framework: absoluteBlocks
          .filter((b) => b.sourceType === 'concept_framework')
          .map((b) => b.content)
          .join('\n\n'),
        yaml_example: buildYamlExample(paperId, frameworkState === 'zero_concepts'),
        researcher_notes: absoluteBlocks
          .filter((b) => b.sourceType === 'researcher_memos')
          .map((b) => b.content)
          .join('\n\n'),
        annotations: absoluteBlocks
          .filter((b) => b.sourceType === 'researcher_annotations')
          .map((b) => b.content)
          .join('\n\n'),
        paper_content: trimmedBlocks
          .filter((b) => b.sourceType === 'paper_fulltext')
          .map((b) => b.content)
          .join('\n\n'),
        retrieval_context: trimmedBlocks
          .filter((b) => b.sourceType === 'rag_passages')
          .map((b) => b.content)
          .join('\n\n'),
        output_language: request.outputLanguage ?? '',
        language_instruction: loadFragment('fragments/language_instruction.md')
          .replace(/\{output_language\}/g, request.outputLanguage ?? ''),
        output_format: taskType === 'analyze'
          ? loadFragment(`output/output_${templateId.replace('analyze-', '')}.md`)
              .replace(/\{paper_id\}/g, paperId)
          : '',
        bilingual_evidence: taskType === 'analyze'
          ? loadFragment('fragments/bilingual_evidence.md')
          : '',
        confidence_calibration: taskType === 'analyze' && frameworkState !== 'zero_concepts'
          ? loadFragment('fragments/confidence_calibration.md')
          : '',
        suggested_concepts_instruction: taskType === 'analyze'
          ? loadFragment('fragments/suggested_concepts_instruction.md')
          : '',
      };
      renderedTemplate = injectVariables(rawTemplate, vars);
    }

    // Build system prompt
    const systemParts = [
      systemPreamble,
      ...absoluteBlocks.filter((b) => b.placement === 'system').map((b) => b.content),
      outputInstructions,
    ].filter(Boolean);

    const systemPrompt = renderedTemplate
      ? renderedTemplate // If template was loaded, it already contains everything
      : systemParts.join('\n\n');

    // Build user message
    const userParts = [
      ...absoluteBlocks.filter((b) => b.placement === 'user').map((b) => b.content),
      ...trimmedBlocks.filter((b) => b.included).map((b) => b.content),
    ].filter(Boolean);

    let userMessage = userParts.join('\n\n');

    // ── Stage 6: Final token verification + iterative trim (§5.3) ──
    let totalTokens =
      this.tokenCounter.count(systemPrompt) + this.tokenCounter.count(userMessage);

    const truncationDetails: Array<{ sourceType: string; originalTokens: number; truncatedTo: number }> = [];
    let truncated = false;

    if (totalTokens > allocation.totalBudget) {
      const overflow = totalTokens - allocation.totalBudget;
      const remaining = iterativeTrim(trimmedBlocks, overflow, this.tokenCounter);

      if (remaining <= 0) {
        // Rebuild user message after trimming
        const newUserParts = [
          ...absoluteBlocks.filter((b) => b.placement === 'user').map((b) => b.content),
          ...trimmedBlocks.filter((b) => b.included).map((b) => b.content),
        ].filter(Boolean);
        userMessage = newUserParts.join('\n\n');
        totalTokens = this.tokenCounter.count(systemPrompt) + this.tokenCounter.count(userMessage);
      }

      truncated = true;
      for (const block of trimmedBlocks) {
        const actual = this.tokenCounter.count(block.content);
        const budget = allocation.sourceAllocations.get(block.sourceType)?.budgetTokens ?? 0;
        if (actual < budget) {
          truncationDetails.push({
            sourceType: block.sourceType,
            originalTokens: budget,
            truncatedTo: actual,
          });
        }
      }
    }

    // ── Stage 7: Return value ──
    const result: AssemblyResult = {
      systemPrompt,
      userMessage,
      estimatedInputTokens: totalTokens,
      estimatedOutputReserve: allocation.outputReserve,
      estimatedTokens: totalTokens, // deprecated compat
      truncated,
      truncationDetails,
      injectedMemoCount: request.memos.length,
      injectedAnnotationCount: request.annotations.length,
      conceptSubsetSize: request.conceptFramework.length,
      strategy: allocation.strategy,
      templateId,
    };

    // §12.3: Assembly log
    this.logger?.debug?.('Prompt assembled', {
      taskType,
      templateId,
      systemPromptTokens: this.tokenCounter.count(systemPrompt),
      userMessageTokens: this.tokenCounter.count(userMessage),
      totalTokens,
      truncated,
      injectedMemoCount: request.memos.length,
      injectedAnnotationCount: request.annotations.length,
      conceptSubsetSize: request.conceptFramework.length,
      strategy: allocation.strategy,
    });

    return result;
  }

  // ─── System preamble builder ───

  private buildSystemPreamble(
    taskType: string,
    frameworkState: FrameworkState,
  ): string {
    if (frameworkState === 'zero_concepts' && taskType === 'analyze') {
      return ZERO_CONCEPT_PREAMBLE;
    }

    const preambles: Record<string, string> = {
      analyze: ANALYZE_PREAMBLE,
      synthesize: SYNTHESIZE_PREAMBLE,
      article: ARTICLE_PREAMBLE,
    };
    return preambles[taskType] ?? ANALYZE_PREAMBLE;
  }

  // ─── Output instructions builder ───

  private buildOutputInstructions(taskType: string, paperId: string): string {
    if (taskType === 'analyze') {
      return ANALYZE_OUTPUT_INSTRUCTIONS + '\n\n' + buildYamlExample(paperId, false);
    }
    if (taskType === 'synthesize') {
      return SYNTHESIZE_OUTPUT_INSTRUCTIONS;
    }
    return ARTICLE_OUTPUT_INSTRUCTIONS;
  }
}

// ─── Factory ───

export function createPromptAssembler(
  tokenCounter: TokenCounter,
  logger?: AssemblerLogger,
): PromptAssembler {
  return new PromptAssembler(tokenCounter, logger);
}

// ─── Preamble constants ───

const ANALYZE_PREAMBLE = `You are an expert academic analyst specializing in research literature analysis. Your task is to analyze the following paper against the researcher's conceptual framework.

For each relevant concept, assess whether the paper provides evidence that supports, challenges, extends, or operationalizes the concept. Be precise with confidence scores and provide specific textual evidence.`;

const ZERO_CONCEPT_PREAMBLE = `You are analyzing an academic paper for a researcher who is in the early exploration phase — no conceptual framework has been defined yet.

Your primary goals:
1. Extract the paper's key arguments and theoretical contributions.
2. Assess the methodology and evidence quality.
3. **Identify up to 5 key concepts/terms** that appear central to this paper's theoretical or empirical contribution — IF the paper makes a distinct conceptual contribution. If the paper lacks strong conceptual focus, return fewer or none.

Output these in the \`suggested_new_concepts\` field of the YAML frontmatter. For each suggestion, include:
- term: the concept/term name
- frequency_in_paper: approximate number of occurrences
- closest_existing: null (no existing concepts to compare)
- reason: why this concept is worth tracking
- suggested_definition: a concise working definition
- suggested_keywords: 3-5 search keywords

Do NOT output a concept_mappings field — there is no conceptual framework to map against.
Focus entirely on suggested_new_concepts.`;

const SYNTHESIZE_PREAMBLE = `You are an expert research synthesizer. Your task is to produce a comprehensive synthesis of the research evidence for a specific concept, drawing from multiple analyzed papers.

Integrate findings across papers, noting convergences and contradictions. Preserve the researcher's prior judgments and flag any evidence gaps.`;

const ARTICLE_PREAMBLE = `You are an expert academic writer. Your task is to produce a section of a research article based on the provided outline, evidence, and synthesis.

Follow the writing style specified in the instructions. Integrate evidence naturally with proper citations.`;

// ─── Output instruction constants ───

const ANALYZE_OUTPUT_INSTRUCTIONS = `## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

YAML schema:
- paper_id: the paper identifier (string)
- paper_type: one of "journal", "conference", "preprint", "theoretical", "review", "book", "chapter", "unknown"
- concept_mappings: array of objects, each with:
  - concept_id: the concept identifier from the framework
  - relation: one of "supports", "challenges", "extends", "operationalizes", "irrelevant"
  - confidence: a float between 0.0 and 1.0
  - evidence: object with { en: string, original: string, original_lang: string }
- suggested_new_concepts: array of objects, each with:
  - term: the concept/term name
  - frequency_in_paper: approximate count
  - closest_existing: nearest concept_id or null
  - reason: why this concept is worth tracking`;

const SYNTHESIZE_OUTPUT_INSTRUCTIONS = `## Output Format

Output your synthesis as Markdown. Structure with clear sections, integrated evidence, and proper citations using [@paper_id] format.`;

const ARTICLE_OUTPUT_INSTRUCTIONS = `## Output Format

Output the article section as Markdown. Use proper academic citation format [@paper_id]. Follow the specified writing style closely.`;
