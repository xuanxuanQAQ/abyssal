/**
 * Level 5: Fail-Save — preserve raw LLM output for human diagnosis.
 *
 * §6.1: Write .raw.txt with metadata header when all parse levels fail.
 * §6.2: Construct structured diagnostics for observability.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDiagnostics, type ParseDiagnostics } from './diagnostics';

// ─── Types ───

export interface FailSaveContext {
  paperId: string;
  model?: string | undefined;
  workflow?: string | undefined;
  frameworkState?: string | undefined;
  workspaceRoot?: string | undefined;
}

export interface FailSaveResult {
  rawPath: string | null;
  diagnostics: ParseDiagnostics;
}

// ─── Logger interface ───

interface FailSaveLogger {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}

// ─── §6.1: Fail-save archive ───

/**
 * Save raw LLM output to .raw.txt with metadata header.
 *
 * File format:
 *   # Parse Failed — {timestamp}
 *   # Paper ID: {paperId}
 *   # Model: {model}
 *   # ... structural feature flags ...
 *   #
 *   # === Original LLM Output Below ===
 *
 *   {raw output}
 */
export function failSave(
  originalOutput: string,
  cleanedOutput: string,
  context: FailSaveContext,
  logger?: FailSaveLogger,
): FailSaveResult {
  // Build diagnostics
  const diagnostics = buildDiagnostics(originalOutput, cleanedOutput, {
    model: context.model,
    frameworkState: context.frameworkState,
  });

  // Write .raw.txt
  let rawPath: string | null = null;

  if (context.workspaceRoot) {
    const analysesDir = path.join(context.workspaceRoot, 'analyses');
    try {
      if (!fs.existsSync(analysesDir)) {
        fs.mkdirSync(analysesDir, { recursive: true });
      }

      rawPath = path.join(analysesDir, `${context.paperId}.raw.txt`);

      const metadataHeader = [
        `# Parse Failed — ${new Date().toISOString()}`,
        `# Paper ID: ${context.paperId}`,
        `# Model: ${context.model ?? 'unknown'}`,
        `# Workflow: ${context.workflow ?? 'unknown'}`,
        `# Framework State: ${context.frameworkState ?? 'unknown'}`,
        `# Output Length: ${originalOutput.length} chars`,
        `# Likely Reason: ${diagnostics.summary}`,
        `# Has Triple Dash: ${diagnostics.hasTripleDash}`,
        `# Has YAML Keywords: ${diagnostics.hasYamlKeywords}`,
        `# Has JSON Braces: ${diagnostics.hasJsonBraces}`,
        `# Has Code Block: ${diagnostics.hasCodeBlock}`,
        `# Line Count: ${diagnostics.lineCount}`,
        `# Preprocessing Changes: ${originalOutput !== cleanedOutput}`,
        '#',
        '# === Original LLM Output Below ===',
        '',
      ].join('\n');

      // Atomic write: write to .tmp then rename
      const tmpPath = rawPath + '.tmp';
      fs.writeFileSync(tmpPath, metadataHeader + originalOutput, 'utf-8');
      fs.renameSync(tmpPath, rawPath);
    } catch (err) {
      // File write failure should not block the parse pipeline
      logger?.warn('Failed to write .raw.txt archive', {
        paperId: context.paperId,
        error: (err as Error).message,
      });
      rawPath = null;
    }
  }

  // TODO — database.updatePaper(context.paperId, { analysis_status: 'failed', failure_reason: 'parse_failed' })
  // Requires DbProxy injection — left to orchestrator workflow layer

  // Log
  logger?.warn('Output parse failed — all 5 levels exhausted', {
    paperId: context.paperId,
    model: context.model,
    outputLength: originalOutput.length,
    diagnosticsSummary: diagnostics.summary,
    rawPath,
  });

  return { rawPath, diagnostics };
}
