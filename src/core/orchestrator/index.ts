/**
 * Orchestrator — re-exports from adapter layer.
 *
 * Core modules should import from here to maintain stable import paths.
 * Actual implementation lives in src/adapter/orchestrator/.
 */

export {
  WorkflowRunner,
  type WorkflowType,
  type WorkflowStatus,
  type WorkflowState,
  type WorkflowProgress,
  type WorkflowOptions,
  type WorkflowResult,
  type WorkflowError,
  type WorkflowStepFn,
  type WorkflowRunnerContext,
} from '../../adapter/orchestrator/workflow-runner';

export {
  parse as parseOutput,
  type ParsedOutput,
} from '../../adapter/output-parser/output-parser';

export {
  type ValidatedMapping as ConceptMapping,
} from '../../adapter/output-parser/field-validator';

export {
  type NormalizedSuggestion as SuggestedNewConcept,
} from '../../adapter/output-parser/suggestion-parser';
