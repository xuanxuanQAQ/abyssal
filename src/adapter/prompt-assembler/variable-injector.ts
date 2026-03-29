/**
 * Variable Injector — frameworkState-driven fragment assembly + placeholder replacement.
 *
 * §2.1: Loads _base_prompt.md + workflow-specific template + conditional fragments,
 * then injects variables into {placeholder} slots.
 *
 * Fragment loading is driven by:
 * - workflow type (analyze / synthesize / article)
 * - frameworkState (zero_concepts → skip maturity_instructions)
 * - qualityReport (insufficient → inject evidence_gaps_warning)
 * - article style (academic_blog / formal_paper / technical_doc)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ───

export type WorkflowType = 'analyze' | 'synthesize' | 'article' | 'discover_screen' | 'agent';
export type FrameworkState = 'zero_concepts' | 'early_exploration' | 'framework_forming' | 'framework_mature';

export interface FragmentAssemblyParams {
  workflow: WorkflowType;
  frameworkState: FrameworkState;
  paperType?: string;
  articleStyle?: string;
  qualityReport?: { coverage?: string; sufficiency?: string };
  /** 'concept' (default) or 'cross' for cross-concept synthesis */
  synthesizeMode?: 'concept' | 'cross';
}

export interface TemplateVariables {
  paper_id?: string;
  paper_type?: string;
  project_name?: string;
  concept_framework?: string;
  maturity_instructions?: string;
  yaml_example?: string;
  researcher_notes?: string;
  annotations?: string;
  paper_content?: string;
  retrieval_context?: string;
  [key: string]: string | undefined;
}

// ─── Template cache (§2.3) ───

interface CacheEntry {
  content: string;
  mtime: number;
}

const templateCache = new Map<string, CacheEntry>();

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * §2.3: Load a template file with mtime-based caching.
 * Development mode: file modification auto-detected via mtime comparison.
 * Production mode: cache hit rate ~100%.
 */
export function loadFile(relativePath: string): string {
  const fullPath = path.resolve(TEMPLATES_DIR, relativePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return ''; // file not found — return empty
  }

  const cached = templateCache.get(relativePath);
  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.content;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  templateCache.set(relativePath, { content, mtime: stat.mtimeMs });
  return content;
}

// ─── §2.1: Fragment assembly ───

/**
 * §2.1: Assemble template segments from base + workflow variant + conditional fragments.
 *
 * Loading order:
 * 1. _base_prompt.md (always)
 * 2. Workflow-specific template (analyze_empirical.md, synthesize.md, etc.)
 * 3. Conditional fragments (maturity, bilingual evidence, confidence, etc.)
 * 4. CRAG warning (if quality report flags gaps)
 */
export function assembleTemplate(params: FragmentAssemblyParams): string {
  const segments: string[] = [];

  // Base prefix (always loaded)
  segments.push(loadFile('_base_prompt.md'));

  // §12: Workflow variant — template combination matrix
  switch (params.workflow) {
    case 'analyze': {
      // §12.1: Analysis workflow template loading
      if (params.frameworkState === 'zero_concepts') {
        segments.push(loadFile('analyze-generic.md'));
        // Output format for generic mode
        segments.push(loadFile('output/output_generic.md'));
      } else {
        const templateType = resolveAnalyzeType(params.paperType);
        segments.push(loadFile(`analyze-${templateType}.md`));
        // Output format per paper type
        segments.push(loadFile(`output/output_${templateType}.md`));
      }

      segments.push(loadFile('fragments/bilingual_evidence.md'));
      segments.push(loadFile('fragments/confidence_calibration.md'));
      segments.push(loadFile('fragments/language_instruction.md'));

      // §5.1: frameworkState-driven suggested_concepts instruction
      segments.push(loadSuggestedConceptsFragment(params.frameworkState));

      break;
    }

    case 'synthesize':
      // §12.2: Synthesize workflow — concept or cross-concept
      if (params.synthesizeMode === 'cross') {
        segments.push(loadFile('synthesize_cross.md'));
      } else {
        segments.push(loadFile('synthesize.md'));
      }
      segments.push(loadFile('fragments/citation_rules.md'));
      segments.push(loadFile('fragments/language_instruction.md'));
      break;

    case 'article': {
      // §12.3: Article workflow — article_section + writing style
      segments.push(loadFile('article_section.md'));
      const styleFile = params.articleStyle
        ? `writing/${params.articleStyle}.md`
        : 'writing/academic_blog.md';
      segments.push(loadFile(styleFile));
      segments.push(loadFile('fragments/citation_rules.md'));
      segments.push(loadFile('fragments/language_instruction.md'));
      break;
    }

    case 'discover_screen':
      // §11: Discover screening template
      segments.push(loadFile('discover_screening.md'));
      break;

    default:
      // agent — base prompt only
      break;
  }

  // Corrective RAG warning (conditional)
  if (
    params.qualityReport &&
    (params.qualityReport.coverage === 'insufficient' ||
      params.qualityReport.sufficiency === 'insufficient')
  ) {
    segments.push(loadFile('fragments/evidence_gaps_warning.md'));
  }

  return segments.filter((s) => s.length > 0).join('\n\n');
}

// ─── §2.2: resolveAnalyzeType ───

function resolveAnalyzeType(paperType?: string): string {
  switch (paperType) {
    case 'journal':
    case 'conference':
    case 'preprint':
      return 'empirical';
    case 'theoretical':
    case 'book':
    case 'chapter':
      return 'theoretical';
    case 'review':
      return 'review';
    default:
      return 'empirical';
  }
}

// ─── §5.1: frameworkState-driven suggested_concepts fragment ───

function loadSuggestedConceptsFragment(frameworkState: FrameworkState): string {
  switch (frameworkState) {
    case 'zero_concepts':
      return loadFile('fragments/suggested_concepts/zero_concepts.md');
    case 'early_exploration':
      return loadFile('fragments/suggested_concepts/early_exploration.md');
    case 'framework_forming':
      return loadFile('fragments/suggested_concepts/framework_forming.md');
    case 'framework_mature':
      return loadFile('fragments/suggested_concepts/framework_mature.md');
    default:
      return loadFile('fragments/suggested_concepts/framework_forming.md');
  }
}

// ─── §4.2/4.4: Per-concept maturity fragment (used by formatConceptSubset) ───

/**
 * Load the maturity-specific instruction fragment for a single concept.
 * Called by the concept subset formatter, not by assembleTemplate.
 *
 * - tentative → maturity_tentative.md (detailed exploratory instructions)
 * - working → no extra fragment (standard behavior is sufficient)
 * - established → maturity_established.md (evidence quality focus)
 */
export function loadMaturityFragment(maturity: string): string {
  switch (maturity) {
    case 'tentative':
      return loadFile('fragments/maturity_tentative.md');
    case 'established':
      return loadFile('fragments/maturity_established.md');
    default:
      return ''; // working — no extra instructions needed
  }
}

// ─── Variable injection ───

/**
 * Inject variables into a template string.
 * Replaces {variable_name} placeholders with values.
 * Unmatched placeholders are replaced with empty strings.
 */
export function injectVariables(template: string, variables: TemplateVariables): string {
  let result = template;

  // Ordered injection (§11.2 compatibility)
  const orderedKeys = [
    'paper_id', 'paper_type', 'project_name', 'concept_framework',
    'maturity_instructions', 'yaml_example', 'researcher_notes',
    'annotations', 'paper_content', 'retrieval_context',
  ];

  for (const key of orderedKeys) {
    const value = variables[key] ?? '';
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  // Remaining custom variables
  for (const [key, value] of Object.entries(variables)) {
    if (orderedKeys.includes(key)) continue;
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
  }

  // Clean up unmatched placeholders
  result = result.replace(/\{[\w_]+\}/g, '');

  return result;
}
