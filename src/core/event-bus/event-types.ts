/**
 * Event Types — unified event taxonomy for AI-centric workbench.
 *
 * All events flow through a single EventBus. The AI (SessionOrchestrator)
 * subscribes to user/pipeline/data events and emits AI command events.
 *
 * Event naming: 'domain:action' (colon-separated camelCase)
 */

import type { ViewType, WorkflowType, PipelineStatus } from '../../shared-types/enums';

// ═══════════════════════════════════════════════════════════════════════
// User Events — renderer → main (user behavior observation)
// ═══════════════════════════════════════════════════════════════════════

export interface UserNavigateEvent {
  type: 'user:navigate';
  view: ViewType;
  previousView: ViewType;
  target?: { paperId?: string; conceptId?: string; articleId?: string; noteId?: string };
}

export interface UserSelectPaperEvent {
  type: 'user:selectPaper';
  paperId: string;
  source: 'library' | 'graph' | 'reader' | 'search' | 'chat';
}

export interface UserSelectConceptEvent {
  type: 'user:selectConcept';
  conceptId: string;
  source: 'graph' | 'analysis' | 'chat';
}

export interface UserSelectTextEvent {
  type: 'user:selectText';
  paperId: string;
  text: string;
  page: number;
  /** Normalized bounding rect on the page */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface UserHighlightEvent {
  type: 'user:highlight';
  paperId: string;
  annotationId: string;
  text: string;
  page: number;
}

export interface UserOpenPaperEvent {
  type: 'user:openPaper';
  paperId: string;
  /** Whether the PDF is available */
  hasPdf: boolean;
}

export interface UserPageChangeEvent {
  type: 'user:pageChange';
  paperId: string;
  page: number;
  totalPages: number;
}

export interface UserSearchEvent {
  type: 'user:search';
  query: string;
  scope: 'global' | 'library' | 'graph' | 'reader';
}

export interface UserIdleEvent {
  type: 'user:idle';
  durationMs: number;
  lastView: ViewType;
}

export interface UserChatEvent {
  type: 'user:chat';
  message: string;
  contextKey: string;
}

export interface UserImportEvent {
  type: 'user:import';
  format: 'bibtex' | 'ris' | 'pdf' | 'doi';
  count: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Pipeline Events — workflow execution lifecycle
// ═══════════════════════════════════════════════════════════════════════

export interface PipelineStartedEvent {
  type: 'pipeline:started';
  taskId: string;
  workflow: WorkflowType;
  paperIds?: string[];
  conceptIds?: string[];
}

export interface PipelineProgressEvent {
  type: 'pipeline:progress';
  taskId: string;
  workflow: WorkflowType;
  status: PipelineStatus;
  currentStep: string;
  progress: { current: number; total: number };
  entityId?: string;
}

export interface PipelineStepCompleteEvent {
  type: 'pipeline:stepComplete';
  taskId: string;
  workflow: WorkflowType;
  step: string;
  result: unknown;
  /** Duration of this step in ms */
  durationMs: number;
}

export interface PipelineCompleteEvent {
  type: 'pipeline:complete';
  taskId: string;
  workflow: WorkflowType;
  result: 'completed' | 'partial' | 'failed' | 'cancelled';
  summary?: string;
}

export interface PipelineDecisionNeededEvent {
  type: 'pipeline:decisionNeeded';
  taskId: string;
  workflow: WorkflowType;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  /** How long to wait before auto-selecting default (ms). 0 = wait forever. */
  timeoutMs: number;
  defaultOptionId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Data Events — database/storage changes
// ═══════════════════════════════════════════════════════════════════════

export interface DataChangedEvent {
  type: 'data:changed';
  table: string;
  operation: 'insert' | 'update' | 'delete';
  ids: string[];
}

export interface DataPaperAddedEvent {
  type: 'data:paperAdded';
  paperId: string;
  title: string;
  source: 'import' | 'discover' | 'manual' | 'chat';
}

export interface DataConceptUpdatedEvent {
  type: 'data:conceptUpdated';
  conceptId: string;
  changeType: 'created' | 'definition' | 'maturity' | 'merged' | 'split' | 'deprecated';
}

export interface DataAnnotationCreatedEvent {
  type: 'data:annotationCreated';
  annotationId: string;
  paperId: string;
  text: string;
  page: number;
}

export interface DataNoteCreatedEvent {
  type: 'data:noteCreated';
  noteId: string;
  title: string;
  linkedPaperIds: string[];
  linkedConceptIds: string[];
}

export interface DataIndexUpdatedEvent {
  type: 'data:indexUpdated';
  entityType: 'paper' | 'note' | 'memo';
  entityId: string;
  chunkCount: number;
}

// ═══════════════════════════════════════════════════════════════════════
// AI Command Events — AI → renderer/main (AI-initiated actions)
// ═══════════════════════════════════════════════════════════════════════

export interface AINavigateEvent {
  type: 'ai:navigate';
  view: ViewType;
  target?: { paperId?: string; conceptId?: string; page?: number; noteId?: string; articleId?: string };
  /** Reason for navigation (shown to user) */
  reason?: string;
}

export interface AIHighlightPassageEvent {
  type: 'ai:highlightPassage';
  paperId: string;
  page: number;
  text: string;
  rect?: { x: number; y: number; w: number; h: number };
  /** Ephemeral highlight (auto-dismiss) vs persistent annotation */
  persistent: boolean;
}

export interface AISuggestEvent {
  type: 'ai:suggest';
  suggestion: {
    id: string;
    title: string;
    description: string;
    actions: Array<{ id: string; label: string; primary?: boolean }>;
    /** Priority: higher = more prominent display */
    priority: number;
    /** Auto-dismiss after ms (0 = manual dismiss only) */
    dismissAfterMs: number;
  };
}

export interface AIUpdateSettingsEvent {
  type: 'ai:updateSettings';
  section: string;
  patch: Record<string, unknown>;
  reason: string;
}

export interface AIExecuteCapabilityEvent {
  type: 'ai:executeCapability';
  capability: string;
  operation: string;
  params: Record<string, unknown>;
}

export interface AIFocusEntityEvent {
  type: 'ai:focusEntity';
  entityType: 'paper' | 'concept' | 'note' | 'article';
  entityId: string;
  /** Optional scroll-to / highlight within the entity */
  anchor?: { page?: number; sectionId?: string; text?: string };
}

export interface AIShowComparisonEvent {
  type: 'ai:showComparison';
  items: Array<{ entityType: 'paper' | 'concept'; entityId: string; label: string }>;
  aspect: string;
}

export interface AINotifyEvent {
  type: 'ai:notify';
  level: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  /** Optional action the user can take */
  action?: { label: string; eventType: string; params: Record<string, unknown> };
}

// ═══════════════════════════════════════════════════════════════════════
// Session Events — session lifecycle
// ═══════════════════════════════════════════════════════════════════════

export interface SessionFocusChangedEvent {
  type: 'session:focusChanged';
  activePapers: string[];
  activeConcepts: string[];
  currentView: ViewType;
}

export interface SessionGoalAddedEvent {
  type: 'session:goalAdded';
  goalId: string;
  description: string;
  relatedEntities: string[];
}

export interface SessionMemoryUpdatedEvent {
  type: 'session:memoryUpdated';
  entryCount: number;
  latestEntry: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Discriminated union of all events
// ═══════════════════════════════════════════════════════════════════════

export type AppEvent =
  // User events
  | UserNavigateEvent
  | UserSelectPaperEvent
  | UserSelectConceptEvent
  | UserSelectTextEvent
  | UserHighlightEvent
  | UserOpenPaperEvent
  | UserPageChangeEvent
  | UserSearchEvent
  | UserIdleEvent
  | UserChatEvent
  | UserImportEvent
  // Pipeline events
  | PipelineStartedEvent
  | PipelineProgressEvent
  | PipelineStepCompleteEvent
  | PipelineCompleteEvent
  | PipelineDecisionNeededEvent
  // Data events
  | DataChangedEvent
  | DataPaperAddedEvent
  | DataConceptUpdatedEvent
  | DataAnnotationCreatedEvent
  | DataNoteCreatedEvent
  | DataIndexUpdatedEvent
  // AI command events
  | AINavigateEvent
  | AIHighlightPassageEvent
  | AISuggestEvent
  | AIUpdateSettingsEvent
  | AIExecuteCapabilityEvent
  | AIFocusEntityEvent
  | AIShowComparisonEvent
  | AINotifyEvent
  // Session events
  | SessionFocusChangedEvent
  | SessionGoalAddedEvent
  | SessionMemoryUpdatedEvent;

/** Extract the event type string literal */
export type AppEventType = AppEvent['type'];

/** Extract a specific event by its type */
export type AppEventOf<T extends AppEventType> = Extract<AppEvent, { type: T }>;
