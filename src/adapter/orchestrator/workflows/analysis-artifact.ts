import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Logger } from '../../../core/infra/logger';

export interface AnalysisArtifactQualityWarning {
  type: 'rag_degraded' | 'concept_stale' | 'context_truncated';
  message: string;
}

export interface AnalysisArtifact {
  version: 2;
  paperId: string;
  stage: string;
  mode: 'generic' | 'intermediate' | 'full';
  businessStatus: 'completed' | 'needs_review' | 'failed';
  model: string | null;
  summary: string;
  body: string;
  warnings: string[];
  qualityWarnings: AnalysisArtifactQualityWarning[];
  metrics?: {
    conceptMappingCount?: number | undefined;
    suggestedConceptCount?: number | undefined;
    truncated?: boolean | undefined;
  } | undefined;
  parse?: {
    strategy?: string | undefined;
    repairRules?: string[] | undefined;
    rawPath?: string | null | undefined;
  } | undefined;
  extra?: Record<string, unknown> | undefined;
  generatedAt: string;
}

export function writeAnalysisArtifact(
  artifact: AnalysisArtifact,
  workspacePath: string,
  logger: Logger,
): string | null {
  const outputPath = path.join(workspacePath, 'analyses', `${artifact.paperId}.analysis.json`);

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), 'utf-8');
    return outputPath;
  } catch (err) {
    logger.debug(`[analyze] Paper ${artifact.paperId}: failed to write structured analysis`, {
      error: (err as Error).message,
    });
    return null;
  }
}

export function extractArtifactSummary(summary: string | null | undefined, body: string): string {
  const cleanSummary = summary?.trim();
  if (cleanSummary && cleanSummary.length > 0) {
    return cleanSummary.slice(0, 2000);
  }

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^#+\s+/gm, '').trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return body.replace(/\s+/g, ' ').trim().slice(0, 2000);
  }

  return paragraphs[0]!.slice(0, 2000);
}