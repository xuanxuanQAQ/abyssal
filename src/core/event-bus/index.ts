export { EventBus } from './event-bus';
export type { EventBusOptions } from './event-bus';
export type {
  AppEvent, AppEventType, AppEventOf,
  // User events
  UserNavigateEvent, UserSelectPaperEvent, UserSelectConceptEvent,
  UserSelectTextEvent, UserHighlightEvent, UserOpenPaperEvent,
  UserPageChangeEvent, UserSearchEvent, UserIdleEvent, UserChatEvent, UserImportEvent,
  // Pipeline events
  PipelineStartedEvent, PipelineProgressEvent as BusPipelineProgressEvent,
  PipelineStepCompleteEvent, PipelineCompleteEvent, PipelineDecisionNeededEvent,
  // Data events
  DataChangedEvent, DataPaperAddedEvent, DataConceptUpdatedEvent,
  DataAnnotationCreatedEvent, DataNoteCreatedEvent, DataIndexUpdatedEvent,
  // AI command events
  AINavigateEvent, AIHighlightPassageEvent, AISuggestEvent,
  AIUpdateSettingsEvent, AIExecuteCapabilityEvent, AIFocusEntityEvent,
  AIShowComparisonEvent, AINotifyEvent,
  // Session events
  SessionFocusChangedEvent, SessionGoalAddedEvent, SessionMemoryUpdatedEvent,
} from './event-types';
