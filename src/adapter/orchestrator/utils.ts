/**
 * Shared utilities for orchestrator workflows.
 */

/**
 * Read a paper record field with camelCase/snake_case fallback.
 * Handles cases where the DB proxy may return either naming convention.
 */
export function paperField<T>(paper: Record<string, unknown> | null | undefined, field: string, fallback: T): T {
  if (!paper) return fallback;
  const snakeCase = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return (paper[field] ?? paper[snakeCase] ?? fallback) as T;
}

/**
 * String-aware brace balancing for safe JSON extraction from LLM output.
 * Finds the first top-level `{...}` block respecting string escaping.
 */
export function extractBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
