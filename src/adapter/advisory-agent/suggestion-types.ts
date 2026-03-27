/**
 * Suggestion types — shared type definitions for Advisory Agent.
 *
 * Extracted from diagnostic-queries.ts for use across rule engine,
 * formatter, IPC handlers, and frontend components.
 *
 * See spec: §3.1-3.2
 */

// ─── Suggestion type enum (§3.2) ───

export type SuggestionType =
  | 'concept_coverage_low'
  | 'mapping_unreviewed'
  | 'mapping_quality_low'
  | 'acquire_failures'
  | 'analyze_failures'
  | 'synthesis_missing'
  | 'writing_dependency'
  | 'concept_suggestion'
  | 'definition_unstable'
  | 'maturity_upgrade'
  | 'unindexed_memos'
  | 'concept_conflict';

// ─── Action types (§5.1) ───

export interface SuggestionAction {
  type: 'navigate' | 'workflow' | 'operation';
  route?: string;
  workflowType?: string;
  workflowOptions?: Record<string, unknown>;
  operation?: string;
  operationArgs?: Record<string, unknown>;
}

// ─── Raw suggestion (§3.1) ───

export interface RawSuggestion {
  type: SuggestionType;
  priority: 'high' | 'medium' | 'low';
  title: string;
  details: Record<string, unknown>;
  action: SuggestionAction;
  diagnosticSource?: string;
}

// ─── Formatted suggestion (sent to frontend) ───

export interface FormattedSuggestion {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  action: SuggestionAction;
  diagnosticSource?: string;
}

// ─── Diagnostic data structure (§2.1) ───

export interface DiagnosticData {
  conceptCoverage: Array<{ conceptId: string; nameEn: string; maturity: string; mappedPapers: number; reviewedPapers: number }>;
  unreviewedMappings: Array<{ conceptId: string; total: number; unreviewed: number }>;
  lowQualityMappings: Array<{ conceptId: string; totalReviewed: number; lowConfidence: number }>;
  acquireFailures: Array<{ failureReason: string; count: number }>;
  analyzeFailures: Array<{ failureReason: string; count: number }>;
  synthesisMissing: Array<{ id: string; nameEn: string }>;
  writingDependencies: Array<{ outlineId: string; sectionTitle: string; seq: number; requiredConceptId: string }>;
  pendingSuggestions: Array<{ term: string; termNormalized?: string; sourcePaperCount: number; reason: string }>;
  unstableDefinitions: Array<{ id: string; nameEn: string; changeCount: number }>;
  maturityUpgrades: Array<{ id: string; nameEn: string; maturity: string; mappedPapers: number; avgConfidence: number }>;
  unindexedMemoCount: number;
  conceptConflicts: Array<{ conceptId: string; conceptName: string; sourcePaperId: string; targetPaperId: string; sourceTitle: string; targetTitle: string }>;
}

// ─── Project stats (for LLM formatting context) ───

export interface ProjectStats {
  totalPapers: number;
  acquiredPapers: number;
  analyzedPapers: number;
  activeConcepts: number;
  totalMappings: number;
  reviewedMappings: number;
  memoCount: number;
  noteCount: number;
  pendingSuggestions: number;
}
