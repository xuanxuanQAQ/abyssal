/**
 * Template Loader — loads Markdown prompt templates and injects variables.
 *
 * Templates live in src/adapter/prompt-assembler/templates/ and use
 * {variable_name} placeholders for dynamic content injection.
 *
 * Template selection logic (§11.3):
 * - frameworkState == 'zero_concepts' → analyze-generic.md
 * - paper_type in (journal, conference, preprint) → analyze-empirical.md
 * - paper_type in (theoretical, book, chapter) → analyze-theoretical.md
 * - paper_type == 'review' → analyze-review.md
 * - paper_type == 'unknown' → analyze-empirical.md (default)
 *
 * Variable injection order (§11.2):
 * 1. paper_id  2. paper_type  3. project_name  4. concept_framework
 * 5. maturity_instructions  6. yaml_example  7. researcher_notes
 * 8. annotations  9. paper_content  10. retrieval_context
 *
 * See spec: §11
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Re-export fragment assembly engine from new module
export {
  loadFile as loadTemplateFile,
} from './variable-injector';

// ─── Template directory ───

const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ─── Template selection (§11.3) ───

export type AnalyzeTemplateId =
  | 'analyze-empirical'
  | 'analyze-theoretical'
  | 'analyze-review'
  | 'analyze-webpage'
  | 'analyze-generic';

export type SynthesizeTemplateId = 'synthesize';

export type ArticleTemplateId =
  | 'article-academic_blog'
  | 'article-formal_paper'
  | 'article-technical_doc'
  | 'article-narrative_review'
  | 'article-policy_brief';

export type TemplateId = AnalyzeTemplateId | SynthesizeTemplateId | ArticleTemplateId;

/**
 * Select the appropriate analyze template based on framework state and paper type.
 */
export function selectAnalyzeTemplate(
  frameworkState: string,
  paperType: string,
): AnalyzeTemplateId {
  if (frameworkState === 'zero_concepts') {
    return 'analyze-generic';
  }

  switch (paperType) {
    case 'journal':
    case 'conference':
    case 'preprint':
      return 'analyze-empirical';
    case 'theoretical':
    case 'book':
    case 'chapter':
      return 'analyze-theoretical';
    case 'review':
      return 'analyze-review';
    case 'webpage':
      return 'analyze-webpage';
    default:
      return 'analyze-empirical'; // default for 'unknown' and others
  }
}

// ─── Template loading ───

/**
 * Load a template file by ID. Returns the raw Markdown content.
 * Falls back to analyze-empirical if template file is not found.
 */
export function loadTemplate(templateId: TemplateId): string {
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.md`);

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Fallback: try to load analyze-empirical as default
    if (templateId !== 'analyze-empirical') {
      const fallbackPath = path.join(TEMPLATES_DIR, 'analyze-empirical.md');
      try {
        return fs.readFileSync(fallbackPath, 'utf-8');
      } catch { /* return empty */ }
    }
    return '';
  }
}

// ─── Variable injection (§11.2) ───

export interface TemplateVariables {
  paper_id?: string;
  paper_type?: string;
  project_name?: string;
  concept_framework?: string;
  yaml_example?: string;
  researcher_notes?: string;
  annotations?: string;
  paper_content?: string;
  retrieval_context?: string;
  [key: string]: string | undefined;
}

/**
 * Inject variables into a template string.
 *
 * Replaces {variable_name} placeholders with values from the variables map.
 * Unmatched placeholders are replaced with empty strings to prevent prompt pollution.
 *
 * Injection order follows §11.2 — though since we do simple string replacement,
 * the order only matters if variables reference each other (they don't in practice).
 */
export function injectVariables(template: string, variables: TemplateVariables): string {
  let result = template;

  // Inject in spec-defined order (§11.2)
  const orderedKeys = [
    'paper_id',
    'paper_type',
    'project_name',
    'concept_framework',
    'yaml_example',
    'researcher_notes',
    'annotations',
    'paper_content',
    'retrieval_context',
  ];

  // First: inject ordered keys
  for (const key of orderedKeys) {
    const value = variables[key] ?? '';
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  // Then: inject any remaining custom variables
  for (const [key, value] of Object.entries(variables)) {
    if (orderedKeys.includes(key)) continue;
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
  }

  // Clean up any remaining unmatched placeholders
  result = result.replace(/\{[\w_]+\}/g, '');

  return result;
}

// ─── JSON example block (§10.2) ───

/**
 * Generate the JSON output format example that is appended to analyze templates.
 * Adding an example significantly improves format compliance (~85% → ~95%+).
 *
 * When zeroConcepts is true, concept_mappings is always an empty array to
 * prevent LLM instruction hallucination — the model would otherwise fabricate
 * concept_ids that don't exist in any framework, triggering FK violations.
 */
export function buildJsonExample(paperId: string, zeroConcepts: boolean = false): string {
  if (zeroConcepts) {
    return `Here is an example of the expected JSON output:
{
  "summary": "A concise summary of the paper...",
  "analysis_markdown": "# Analysis\\n\\n...",
  "concept_mappings": [],
  "suggested_new_concepts": [
    {
      "term": "example_term",
      "frequency_in_paper": 5,
      "closest_existing": null,
      "reason": "This term appears frequently...",
      "suggested_definition": "A concise working definition",
      "suggested_keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}`;
  }

  return `Here is an example of the expected JSON output:
{
  "summary": "A concise summary of the paper...",
  "analysis_markdown": "# Analysis\\n\\n...",
  "concept_mappings": [
    {
      "concept_id": "example_concept",
      "relation": "supports",
      "confidence": 0.75,
      "evidence": {
        "en": "The paper provides evidence that...",
        "original": "论文提供了证据表明...",
        "original_lang": "zh-CN",
        "chunk_id": null,
        "page": null,
        "annotation_id": null
      }
    }
  ],
  "suggested_new_concepts": [
    {
      "term": "example_term",
      "frequency_in_paper": 5,
      "closest_existing": "related_concept",
      "reason": "This term appears frequently...",
      "suggested_definition": null,
      "suggested_keywords": null
    }
  ]
}`;
}

/** @deprecated Use buildJsonExample instead */
export const buildYamlExample = buildJsonExample;
