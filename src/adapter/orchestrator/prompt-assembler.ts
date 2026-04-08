/**
 * Prompt Assembler — compatibility layer preserving existing public API.
 *
 * Existing functions (selectConceptSubset, buildConceptFrameworkSection, etc.)
 * are preserved here for backward compatibility with analyze.ts and other
 * workflow consumers.
 *
 * New code should use the full assembly pipeline from
 * '../prompt-assembler/prompt-assembler' directly.
 *
 * See spec: §2.2–2.5, §3.2–3.3, §4.2, §5.1
 */

// Re-export the new assembly pipeline
export {
  PromptAssembler,
  createPromptAssembler,
  type AssemblyRequest,
  type AssemblyResult,
  type FrameworkState,
} from '../prompt-assembler/prompt-assembler';

// Re-export section formatting utilities
export {
  formatConceptFramework,
  formatMemos,
  formatAnnotations,
  formatRagPassages,
  formatAdjudicationHistory,
  formatEvidenceGaps,
  formatProtectedParagraphs,
  type ConceptForFormat,
  type MemoForFormat,
  type AnnotationForFormat,
  type RagPassageForFormat,
  type AdjudicationForFormat,
} from '../prompt-assembler/section-formatter';

// Re-export template loading
export {
  loadTemplate,
  selectAnalyzeTemplate,
  buildJsonExample,
  buildYamlExample,
  type TemplateId,
} from '../prompt-assembler/template-loader';

// Re-export truncation engine
export {
  truncateContent,
  truncateRagPassages,
  iterativeTrim,
  type TokenCounter,
} from '../prompt-assembler/truncation-engine';

// Re-export 6D concept subset selector (annotation, keyword, network, maturity, parent, semantic)
export {
  filterConceptSubset,
  filterConceptSubsetAsync,
  scoreAllConcepts,
  type SubsetSelectorDb,
  type SubsetResult,
  type ScoredConceptResult as ScoredConcept,
} from '../prompt-assembler/concept-subset-selector';

// Re-export maturity evaluator
export {
  resolveMaturityParams,
  buildMaturityInstructions,
} from './workflows/concept-evolution/maturity-evaluator';

// ─── Legacy types (kept for backward compatibility) ───

export interface ConceptForPrompt {
  id: string;
  nameEn: string;
  nameZh: string;
  definition: string;
  searchKeywords: string[];
  maturity: 'tentative' | 'working' | 'established';
}

export interface MemoForPrompt {
  text: string;
  createdAt: string;
  conceptIds: string[];
  paperIds: string[];
}

export interface AdjudicationEntry {
  paperId: string;
  paperTitle: string;
  paperYear: number;
  relation: string;
  confidence: number;
  decision: 'accepted' | 'revised' | 'rejected';
  decisionNote: string | null;
  revisedRelation?: string;
  revisedConfidence?: number;
}

export interface PaperContext {
  id: string;
  title: string;
  abstract: string;
}

// ─── Legacy functions (delegate to new modules) ───

import {
  formatConceptFramework as _formatConceptFramework,
  formatMemos as _formatMemos,
  formatAdjudicationHistory as _formatAdjudicationHistory,
  formatEvidenceGaps as _formatEvidenceGaps,
  formatProtectedParagraphs as _formatProtectedParagraphs,
  type ConceptForFormat,
  type MemoForFormat,
} from '../prompt-assembler/section-formatter';

/**
 * Select concept subset by relevance scoring (§2.2).
 * Preserved for backward compatibility.
 */
export function selectConceptSubset(
  allConcepts: ConceptForPrompt[],
  paper: PaperContext,
  maxConcepts: number = 15,
): ConceptForPrompt[] {
  if (allConcepts.length <= maxConcepts) return allConcepts;

  const scored = allConcepts.map((c) => ({
    concept: c,
    relevance: computeRelevance(c, paper),
  }));
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, maxConcepts).map((s) => s.concept);
}

function computeRelevance(concept: ConceptForPrompt, paper: PaperContext): number {
  let score = 0;
  const titleLower = paper.title.toLowerCase();
  const abstractLower = (paper.abstract ?? '').toLowerCase();

  for (const keyword of concept.searchKeywords) {
    const kw = keyword.toLowerCase();
    if (titleLower.includes(kw)) score += 3;
    if (abstractLower.includes(kw)) score += 2;
  }

  if (concept.maturity === 'tentative') score += 2;

  return score;
}

/**
 * Build concept framework section (§2.3).
 * Delegates to section-formatter.
 */
export function buildConceptFrameworkSection(concepts: ConceptForPrompt[]): string {
  if (concepts.length === 0) return '';

  const formatted: ConceptForFormat[] = concepts.map((c) => ({
    id: c.id,
    nameEn: c.nameEn,
    nameZh: c.nameZh,
    definition: c.definition,
    searchKeywords: c.searchKeywords,
    maturity: c.maturity,
  }));

  return '## Concept Framework\n\n' + _formatConceptFramework(formatted);
}

/**
 * Build memo section (§2.4).
 * Delegates to section-formatter.
 */
export function buildMemoSection(memos: MemoForPrompt[], currentPaperId?: string): string {
  if (memos.length === 0) return '';

  const formatted: MemoForFormat[] = memos.map((m) => ({
    text: m.text,
    createdAt: m.createdAt,
    conceptIds: m.conceptIds,
    paperIds: m.paperIds,
  }));

  return "## Researcher's Intuitions & Notes\n\n" + _formatMemos(formatted, currentPaperId);
}

/**
 * Build zero-concept system prompt (§2.5).
 */
export function buildZeroConceptSystemPrompt(): string {
  return `## Task
You are analyzing an academic paper for a researcher who is in the
early exploration phase — no conceptual framework has been defined yet.

Your primary goals:
1. Extract the paper's key arguments and theoretical contributions.
2. Assess the methodology and evidence quality.
3. **Identify up to 5 key concepts/terms** that appear central to this
   paper's theoretical or empirical contribution — IF the paper makes
   a distinct conceptual contribution. Return fewer or none if the
   paper lacks strong conceptual focus.

Output these in the \`suggested_new_concepts\` field of the YAML
frontmatter. For each suggestion, include:
- term: the concept/term name
- frequency_in_paper: approximate number of occurrences
- closest_existing: null (no existing concepts to compare)
- reason: why this concept is worth tracking
- suggested_definition: a concise working definition
- suggested_keywords: 3-5 search keywords

Do NOT output a concept_mappings field — there is no conceptual
framework to map against. Focus entirely on suggested_new_concepts.`;
}

/**
 * Build adjudication section (§3.2).
 */
export function buildAdjudicationSection(
  conceptName: string,
  entries: AdjudicationEntry[],
): string {
  if (entries.length === 0) return '';

  const formatted = entries.map((e) => ({
    paperId: e.paperId,
    paperTitle: e.paperTitle,
    paperYear: e.paperYear,
    relation: e.relation,
    confidence: e.confidence,
    decision: e.decision,
    decisionNote: e.decisionNote,
    revisedRelation: e.revisedRelation,
    revisedConfidence: e.revisedConfidence,
  }));

  return `## Researcher's Judgments on Concept "${conceptName}"\n\n` +
    _formatAdjudicationHistory(conceptName, formatted);
}

/**
 * Build evidence gaps section (§3.3).
 */
export function buildEvidenceGapsSection(conceptName: string, gaps: string[]): string {
  if (gaps.length === 0) return '';

  return `## ⚠️ Evidence Limitation Notice\n\n` + _formatEvidenceGaps(conceptName, gaps);
}

/**
 * Build protected paragraphs section (§4.2).
 */
export function buildProtectedParagraphsSection(
  content: string,
  editedIndices: number[],
): string {
  if (editedIndices.length === 0) return '';

  return '## Protected Paragraphs\n\n' + _formatProtectedParagraphs(content, editedIndices);
}
