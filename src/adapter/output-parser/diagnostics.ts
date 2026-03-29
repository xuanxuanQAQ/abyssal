/**
 * Diagnostics — structured parse failure diagnosis.
 *
 * §6.2: Analyze output structural features to predict failure reason.
 * §12: Provide structured context for observability logs.
 */

// ─── Types ───

export type LikelyFailureReason =
  | 'no_structured_output'    // LLM completely ignored format requirements
  | 'empty_yaml'              // YAML fence exists but no expected fields
  | 'yaml_without_fence'      // YAML content present but missing --- delimiters
  | 'malformed_json'          // JSON structure present but format errors
  | 'severe_format_error'     // YAML exists but severely malformed
  | 'unknown';

export interface ParseDiagnostics {
  summary: LikelyFailureReason;
  outputLength: number;
  firstChars: string;
  lastChars: string;
  hasTripleDash: boolean;
  hasYamlKeywords: boolean;
  hasJsonBraces: boolean;
  hasCodeBlock: boolean;
  lineCount: number;
  model: string;
  frameworkState: string;
}

export interface DiagnosticContext {
  model?: string | undefined;
  frameworkState?: string | undefined;
}

// ─── §6.2: Diagnostic builder ───

/**
 * Build structured diagnostics from failed parse output.
 *
 * Analyzes structural features to predict the most likely failure reason,
 * aiding debugging and backend-specific issue tracking.
 */
export function buildDiagnostics(
  originalOutput: string,
  cleanedOutput: string,
  context: DiagnosticContext,
): ParseDiagnostics {
  const hasTripleDash = originalOutput.includes('---');
  const hasYamlKeywords = /concept_mappings|concept_id|relation|confidence/.test(originalOutput);
  const hasJsonBraces = /\{[\s\S]*\}/.test(originalOutput);
  const hasCodeBlock = /```/.test(originalOutput);

  let summary: LikelyFailureReason = 'unknown';

  if (!hasTripleDash && !hasCodeBlock && !hasJsonBraces) {
    summary = 'no_structured_output';
  } else if (hasTripleDash && !hasYamlKeywords) {
    summary = 'empty_yaml';
  } else if (hasYamlKeywords && !hasTripleDash && !hasCodeBlock) {
    summary = 'yaml_without_fence';
  } else if (hasJsonBraces && !hasTripleDash) {
    summary = 'malformed_json';
  } else if (hasTripleDash && hasYamlKeywords) {
    summary = 'severe_format_error';
  }

  return {
    summary,
    outputLength: originalOutput.length,
    firstChars: originalOutput.slice(0, 500),
    lastChars: originalOutput.slice(-200),
    hasTripleDash,
    hasYamlKeywords,
    hasJsonBraces,
    hasCodeBlock,
    lineCount: originalOutput.split('\n').length,
    model: context.model ?? 'unknown',
    frameworkState: context.frameworkState ?? 'unknown',
  };
}
