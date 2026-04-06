/**
 * Copilot Runtime — Public API barrel export.
 */

export * from './types';
export { CopilotRuntime } from './runtime';
export { RecipeRegistry } from './recipe-registry';
export { IntentRouter } from './intent-router';
export { IntentEmbeddingIndex } from './intent-embedding-index';
export { ContextSnapshotBuilder } from './context-builder';
export { ExecutionCoordinator } from './execution-coordinator';
export { OperationEventEmitter } from './event-emitter';
export { CopilotSessionManager } from './session-manager';
export { TraceStore } from './trace-store';
export { IdempotencyGuard } from './idempotency-guard';
export { ConfirmationEvaluator } from './confirmation';
export { FailurePolicyEvaluator } from './failure-policy';

// Recipes
export { builtinRecipes } from './recipes';

// Executors
export { AgentExecutor } from './executors/agent-executor';
export { RetrievalExecutor } from './executors/retrieval-executor';
export { EditorExecutor } from './executors/editor-executor';
export { WorkflowExecutor } from './executors/workflow-executor';
export { NavigationExecutor } from './executors/navigation-executor';
