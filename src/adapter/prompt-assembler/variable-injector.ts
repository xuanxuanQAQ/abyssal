/**
 * Variable Injector — template file loading + placeholder replacement.
 *
 * Loads template files with mtime-based caching and injects variables
 * into {placeholder} slots.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ───

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
    'yaml_example', 'researcher_notes',
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
