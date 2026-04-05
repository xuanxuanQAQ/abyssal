/**
 * Copilot Runtime — Core Type Definitions
 *
 * Unified operation model replacing dual chat/pipeline protocols.
 * All AI interactions flow through CopilotOperation → Runtime → Executors.
 */

import type { ViewType, WorkflowType } from '../shared-types/enums';
import type { ChatImageClip } from '../shared-types/ipc';

// ═══════════════════════════════════════════════════════════════════════
// Surface & Intent
// ═══════════════════════════════════════════════════════════════════════

export type CopilotSurface =
  | 'chat'
  | 'editor-toolbar'
  | 'reader-selection'
  | 'analysis-panel'
  | 'command-palette'
  | 'outline-menu'
  | 'note-panel';

export type CopilotIntent =
  | 'ask'
  | 'rewrite-selection'
  | 'expand-selection'
  | 'compress-selection'
  | 'continue-writing'
  | 'generate-section'
  | 'insert-citation-sentence'
  | 'draft-citation'
  | 'summarize-selection'
  | 'summarize-section'
  | 'review-argument'
  | 'retrieve-evidence'
  | 'navigate'
  | 'run-workflow';

// ═══════════════════════════════════════════════════════════════════════
// Operation Envelope & Options
// ═══════════════════════════════════════════════════════════════════════

export interface CopilotOperationEnvelope {
  operation: CopilotOperation;
  options?: CopilotExecutionOptions;
}

export interface CopilotOperation {
  id: string;
  sessionId: string;
  surface: CopilotSurface;
  intent: CopilotIntent;
  prompt: string;
  context: ContextSnapshot;
  outputTarget: OutputTarget;
  constraints?: CopilotConstraints;
  metadata?: Record<string, unknown>;
}

export interface CopilotExecutionOptions {
  priority?: 'foreground' | 'background';
  interactive?: boolean;
  allowToolUse?: boolean;
  allowMutation?: boolean;
  traceLevel?: 'minimal' | 'standard' | 'verbose';
  skipIdempotency?: boolean;
}

export interface CopilotConstraints {
  maxContextTokens?: number;
  maxOutputTokens?: number;
  requireCitation?: boolean;
  preferExistingEvidence?: boolean;
  preserveSelection?: boolean;
  requireUserConfirmation?: boolean;
  contextPolicy?: 'minimal' | 'standard' | 'deep';
}

// ═══════════════════════════════════════════════════════════════════════
// Context Snapshot
// ═══════════════════════════════════════════════════════════════════════

export interface ContextSnapshot {
  activeView: ViewType;
  workspaceId: string;
  article: ArticleFocus | null;
  selection: SelectionContext | null;
  focusEntities: FocusEntities;
  conversation: ConversationContext;
  retrieval: RetrievalContext;
  writing: WritingContextState | null;
  budget: ContextBudget;
  frozenAt: number;
}

export interface ContextBudget {
  policy: 'minimal' | 'standard' | 'deep';
  tokenBudget: number;
  includedLayers: Array<'surface' | 'working' | 'retrieval' | 'history'>;
}

export interface ArticleFocus {
  articleId: string;
  sectionId: string | null;
  sectionTitle?: string;
  articleTitle?: string;
  previousSectionSummaries?: string[];
  nextSectionTitles?: string[];
}

export type SelectionContext =
  | ReaderSelectionContext
  | EditorSelectionContext
  | GraphSelectionContext;

export interface ReaderSelectionContext {
  kind: 'reader';
  paperId: string;
  selectedText: string;
  pdfPage?: number;
  imageClips?: ChatImageClip[];
}

export interface EditorSelectionContext {
  kind: 'editor';
  articleId: string;
  sectionId: string;
  selectedText: string;
  from: number;
  to: number;
  anchorParagraphId?: string;
  beforeText?: string;
  afterText?: string;
  selectionMarkdown?: string;
}

export interface GraphSelectionContext {
  kind: 'graph';
  nodeId: string;
  nodeType: 'paper' | 'concept' | 'memo' | 'note';
}

export interface FocusEntities {
  paperIds: string[];
  conceptIds: string[];
  mappingIds?: string[];
  memoIds?: string[];
  noteIds?: string[];
}

export interface ConversationContext {
  recentTurns: Array<{
    role: 'user' | 'assistant' | 'system';
    text: string;
  }>;
  currentGoal?: string;
  lastOperationId?: string;
}

export interface RetrievalContext {
  evidence: EvidenceChunk[];
  lastQuery?: string;
}

export interface EvidenceChunk {
  chunkId: string;
  paperId: string;
  text: string;
  score: number;
  citationLabel?: string;
}

export interface WritingContextState {
  editorId: string;
  articleId: string;
  sectionId: string | null;
  unsavedChanges: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Output Target
// ═══════════════════════════════════════════════════════════════════════

export type OutputTarget =
  | ChatMessageTarget
  | EditorSelectionReplaceTarget
  | EditorInsertAfterTarget
  | SectionAppendTarget
  | SectionReplaceTarget
  | NavigationTarget
  | WorkflowTarget;

export interface ChatMessageTarget {
  type: 'chat-message';
}

export interface EditorSelectionReplaceTarget {
  type: 'editor-selection-replace';
  editorId: string;
  articleId: string;
  sectionId: string;
  from: number;
  to: number;
}

export interface EditorInsertAfterTarget {
  type: 'editor-insert-after';
  editorId: string;
  articleId: string;
  sectionId: string;
  pos: number;
}

export interface SectionAppendTarget {
  type: 'section-append';
  articleId: string;
  sectionId: string;
}

export interface SectionReplaceTarget {
  type: 'section-replace';
  articleId: string;
  sectionId: string;
}

export interface NavigationTarget {
  type: 'navigate';
  view: ViewType;
  entityId?: string;
}

export interface WorkflowTarget {
  type: 'workflow';
  workflow: WorkflowType;
  config?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Editor Patch
// ═══════════════════════════════════════════════════════════════════════

/** Tiptap JSONContent — keeping flexible to avoid tight coupling */
export type JSONContent = Record<string, unknown>;

export type EditorPatch =
  | ReplaceRangePatch
  | InsertAtPatch
  | ReplaceSectionPatch
  | AnnotateRangePatch;

export interface ReplaceRangePatch {
  kind: 'replace-range';
  editorId: string;
  from: number;
  to: number;
  content: JSONContent;
  preconditions?: PatchPrecondition;
  schema?: PatchSchemaInfo;
}

export interface InsertAtPatch {
  kind: 'insert-at';
  editorId: string;
  pos: number;
  content: JSONContent;
  preconditions?: PatchPrecondition;
  schema?: PatchSchemaInfo;
}

export interface ReplaceSectionPatch {
  kind: 'replace-section';
  editorId: string;
  sectionId: string;
  content: JSONContent;
  preconditions?: PatchPrecondition;
  schema?: PatchSchemaInfo;
}

export interface AnnotateRangePatch {
  kind: 'annotate-range';
  editorId: string;
  from: number;
  to: number;
  attrs: Record<string, string>;
  preconditions?: PatchPrecondition;
  schema?: PatchSchemaInfo;
}

export interface PatchPrecondition {
  articleId: string;
  sectionId: string;
  editorId: string;
  anchorParagraphId?: string;
  expectedSelection?: { from: number; to: number };
  expectedFingerprint?: string;
}

export interface PatchSchemaInfo {
  editorSchemaVersion: string;
  patchFormatVersion: string;
}

export interface ReconciliationResult {
  ok: boolean;
  reason?:
    | 'editor_changed'
    | 'section_missing'
    | 'anchor_missing'
    | 'selection_shifted'
    | 'content_diverged';
  fallbackTarget?: OutputTarget;
}

// ═══════════════════════════════════════════════════════════════════════
// Recipe & Execution Plan
// ═══════════════════════════════════════════════════════════════════════

export interface OperationRecipe {
  id: string;
  intents: CopilotIntent[];
  priority: number;
  specificity: number;
  matches(operation: CopilotOperation, context: ContextSnapshot): boolean;
  buildPlan(operation: CopilotOperation, context: ContextSnapshot): Promise<ExecutionPlan>;
}

export interface ExecutionPlan {
  recipeId: string;
  target: OutputTarget;
  steps: ExecutionStep[];
  confirmation: ConfirmationPolicy;
}

export type ExecutionStep =
  | { kind: 'retrieve'; query: string; source: 'rag' | 'notes' | 'graph' }
  | { kind: 'llm_generate'; mode: 'chat' | 'draft' | 'patch' }
  | { kind: 'validate_citation' }
  | { kind: 'apply_patch'; patchTarget: OutputTarget }
  | { kind: 'run_workflow'; workflow: WorkflowType; config?: Record<string, unknown> }
  | { kind: 'navigate'; view: ViewType; entityId?: string };

export interface RecipeResolution {
  selected: OperationRecipe | null;
  candidates: string[];
  resolution:
    | 'no_match'
    | 'single_match'
    | 'priority'
    | 'specificity'
    | 'surface_alignment'
    | 'deferred_to_user';
}

// ═══════════════════════════════════════════════════════════════════════
// Failure & Degradation
// ═══════════════════════════════════════════════════════════════════════

export type FailureStage =
  | 'intent_resolution'
  | 'recipe_resolution'
  | 'context_building'
  | 'retrieval'
  | 'generation'
  | 'validation'
  | 'patch_reconciliation'
  | 'patch_apply'
  | 'workflow_execution'
  | 'navigation_execution';

export type DegradationMode =
  | 'ask_for_clarification'
  | 'fallback_to_chat_message'
  | 'fallback_to_patch_preview'
  | 'fallback_to_plain_draft'
  | 'retry_with_reduced_context'
  | 'abort_without_apply'
  | 'return_partial_result';

export interface FailurePolicy {
  stage: FailureStage;
  condition: string;
  degradation: DegradationMode;
  userMessage: string;
  preserveArtifacts?: boolean;
  retryAllowed?: boolean;
}

export interface DegradationRecord {
  stage: FailureStage;
  mode: DegradationMode;
  reason: string;
  preservedArtifacts?: Array<'draft' | 'patch' | 'retrieval_results' | 'tool_outputs'>;
}

// ═══════════════════════════════════════════════════════════════════════
// Confirmation Strategy
// ═══════════════════════════════════════════════════════════════════════

export type ConfirmationMode =
  | 'auto'
  | 'preview'
  | 'explicit'
  | 'intent-clarification'
  | 'forbidden';

export interface ConfirmationPolicy {
  mode: ConfirmationMode;
  reason: string;
  requiredFor: 'intent' | 'execution' | 'destructive-mutation';
  expiresInMs?: number;
}

export interface ConfirmationRequest {
  operationId: string;
  mode: ConfirmationMode;
  title: string;
  message: string;
  previewPatch?: EditorPatch;
  expiresAt?: number;
}

export interface ConfirmationRule {
  targetType: OutputTarget['type'];
  mutationRisk: 'low' | 'medium' | 'high';
  defaultMode: ConfirmationMode;
}

// ═══════════════════════════════════════════════════════════════════════
// Clarification
// ═══════════════════════════════════════════════════════════════════════

export interface ClarificationOption {
  id: string;
  label: string;
  targetIntent?: CopilotIntent;
  targetRecipeId?: string;
}

export interface ClarificationRequest {
  operationId: string;
  sessionId: string;
  question: string;
  options: ClarificationOption[];
  resumeOperation: CopilotOperation;
  continuationToken: string;
  expiresAt?: number;
}

export interface ResumeOperationRequest {
  operationId: string;
  continuationToken: string;
  selectedOptionId: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Idempotency
// ═══════════════════════════════════════════════════════════════════════

export interface IdempotencyKey {
  operationId: string;
  surface: CopilotSurface;
  fingerprint: string;
  dedupeWindowMs: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Event Model
// ═══════════════════════════════════════════════════════════════════════

export type CopilotOperationEvent =
  | OperationStartedEvent
  | ContextResolvedEvent
  | PlanningFinishedEvent
  | RetrievalStartedEvent
  | RetrievalFinishedEvent
  | ModelDeltaEvent
  | ToolCallEvent
  | PatchProposedEvent
  | PatchAppliedEvent
  | OperationClarificationRequiredEvent
  | OperationCompletedEvent
  | OperationFailedEvent
  | OperationAbortedEvent
  | PersistenceSucceededEvent
  | PersistenceFailedEvent;

interface BaseOperationEvent {
  operationId: string;
  sequence: number;
  emittedAt: number;
}

export interface OperationStartedEvent extends BaseOperationEvent {
  type: 'operation.started';
  sessionId: string;
  intent: CopilotIntent;
}

export interface ContextResolvedEvent extends BaseOperationEvent {
  type: 'context.resolved';
  summary: string;
}

export interface PlanningFinishedEvent extends BaseOperationEvent {
  type: 'planning.finished';
  steps: string[];
}

export interface RetrievalStartedEvent extends BaseOperationEvent {
  type: 'retrieval.started';
  query: string;
}

export interface RetrievalFinishedEvent extends BaseOperationEvent {
  type: 'retrieval.finished';
  evidenceCount: number;
}

export interface ModelDeltaEvent extends BaseOperationEvent {
  type: 'model.delta';
  channel: 'chat' | 'draft';
  text: string;
}

export interface ToolCallEvent extends BaseOperationEvent {
  type: 'tool.call';
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export interface PatchProposedEvent extends BaseOperationEvent {
  type: 'patch.proposed';
  patch: EditorPatch;
}

export interface PatchAppliedEvent extends BaseOperationEvent {
  type: 'patch.applied';
  patch: EditorPatch;
}

export interface OperationClarificationRequiredEvent extends BaseOperationEvent {
  type: 'operation.clarification_required';
  question: string;
  options: ClarificationOption[];
}

export interface OperationCompletedEvent extends BaseOperationEvent {
  type: 'operation.completed';
  resultSummary?: string;
}

export interface OperationFailedEvent extends BaseOperationEvent {
  type: 'operation.failed';
  code: string;
  message: string;
}

export interface OperationAbortedEvent extends BaseOperationEvent {
  type: 'operation.aborted';
}

export interface PersistenceSucceededEvent extends BaseOperationEvent {
  type: 'persistence.succeeded';
}

export interface PersistenceFailedEvent extends BaseOperationEvent {
  type: 'persistence.failed';
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Terminal State
// ═══════════════════════════════════════════════════════════════════════

export interface OperationTerminalState {
  operationId: string;
  terminalStatus: 'completed' | 'failed' | 'aborted';
  terminalAt: number;
}

export interface OperationStatusSnapshot {
  operationId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'clarification_required';
  lastSequence: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Trace
// ═══════════════════════════════════════════════════════════════════════

export interface CopilotOperationTrace {
  operationId: string;
  sessionId: string;
  startedAt: number;
  finishedAt?: number;
  phases: TracePhase[];
  degradations?: DegradationRecord[];
}

export interface TracePhase {
  name: 'normalize' | 'context' | 'recipe' | 'plan' | 'execute' | 'apply';
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed';
  detail?: Record<string, unknown>;
  error?: { code: string; message: string; stack?: string };
}

export interface CopilotOperationTraceSummary {
  operationId: string;
  sessionId: string;
  intent: CopilotIntent;
  surface: CopilotSurface;
  status: 'completed' | 'failed' | 'aborted' | 'partial';
  recipeId?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Session Model
// ═══════════════════════════════════════════════════════════════════════

export interface CopilotSessionSummary {
  id: string;
  title: string;
  activeView: ViewType;
  updatedAt: number;
  articleId?: string;
  sectionId?: string;
}

export interface CopilotSessionState {
  id: string;
  title: string;
  currentGoal?: string;
  activeOperationId?: string;
  timeline: CopilotOperationEvent[];
  lastContextSnapshot?: ContextSnapshot;
  /** Pending clarification, if any */
  pendingClarification?: ClarificationRequest;
}

export interface CopilotExecuteResult {
  operationId: string;
  sessionId: string;
}
