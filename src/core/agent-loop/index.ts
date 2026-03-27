/**
 * Agent Loop — re-exports from adapter layer.
 *
 * Core modules should import from here to maintain stable import paths.
 * Actual implementation lives in src/adapter/agent-loop/.
 */

export {
  AgentLoop,
  type AgentLoopOptions,
  type ConversationState,
} from '../../adapter/agent-loop/agent-loop';

export {
  ToolRegistry,
  type ToolServices,
} from '../../adapter/agent-loop/tool-registry';

export {
  buildSystemPrompt,
  type SystemPromptContext,
} from '../../adapter/agent-loop/system-prompt-builder';
