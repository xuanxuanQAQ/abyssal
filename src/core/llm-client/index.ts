/**
 * LLM Client — re-exports from adapter layer.
 *
 * Core modules should import from here to maintain stable import paths.
 * Actual implementation lives in src/adapter/llm-client/.
 */

export {
  LlmClient,
  createLlmClient,
  type Message,
  type ContentBlock,
  type ToolDefinition,
  type ToolCall,
  type TokenUsage,
  type FinishReason,
  type CompletionResult,
  type StreamChunk,
  type CompleteParams,
  type LlmAdapter,
  type CreateLlmClientOpts,
} from '../../adapter/llm-client/llm-client';

export {
  CostTracker,
  type CostStats,
  type CostRecord,
} from '../../adapter/llm-client/cost-tracker';

export {
  ModelRouter,
  type ModelRoute,
} from '../../adapter/llm-client/model-router';

export {
  RerankerScheduler,
} from '../../adapter/llm-client/reranker';

export {
  ContextBudgetManager,
  createContextBudgetManager,
  type BudgetRequest,
  type BudgetAllocation,
} from '../../adapter/context-budget/context-budget-manager';
