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
  parseOutput,
  extractConceptMappings,
  extractSuggestedConcepts,
  type ParsedOutput,
  type ConceptMapping,
  type SuggestedNewConcept,
} from '../../adapter/orchestrator/output-parser';
