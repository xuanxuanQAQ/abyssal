/**
 * Capability Layer Types — composable domain capabilities for AI orchestration.
 *
 * Capabilities replace the dual tools/workflows model:
 * - Each capability groups related operations by domain
 * - Operations have access to the ResearchSession for cross-pipeline context
 * - The AI can chain capabilities: reader.find_passages → notes.create_from_findings
 * - Capabilities are exposed as LLM tools via a bridge in the ToolRegistry
 */

import type { ResearchSession } from '../../core/session';
import type { EventBus } from '../../core/event-bus';

// ─── Core types ───

export type CapabilityDomain =
  | 'reader'
  | 'analysis'
  | 'notes'
  | 'graph'
  | 'discovery'
  | 'writing'
  | 'ui'
  | 'config';

export type ToolRouteFamily =
  | 'research_qa'
  | 'retrieval_search'
  | 'config_diagnostic'
  | 'workspace_control'
  | 'ui_navigation'
  | 'writing_edit'
  | 'mixed_fallback';

export type PermissionLevel = 0 | 1 | 2;

export interface OperationParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enumValues?: string[];
  itemType?: string;
  default?: unknown;
}

export interface OperationResult {
  success: boolean;
  data?: unknown;
  /** Human-readable summary of what happened */
  summary: string;
  /** Side-effect events that were emitted */
  emittedEvents?: string[];
}

export interface CapabilityOperation {
  name: string;
  description: string;
  params: OperationParam[];
  permissionLevel: PermissionLevel;
  routeFamilies?: ToolRouteFamily[];
  /** Semantic keywords for operation matching and scoring (0-5 priority order) */
  semanticKeywords?: string[];
  /** Execute the operation */
  execute: (
    params: Record<string, unknown>,
    ctx: OperationContext,
  ) => Promise<OperationResult>;
}

export interface OperationContext {
  session: ResearchSession;
  eventBus: EventBus;
  /** Services injected from AppContext */
  services: CapabilityServices;
  /** Abort signal propagated from the orchestrator — operations should check this for cancellation */
  signal?: AbortSignal;
}

export interface Capability {
  name: string;
  domain: CapabilityDomain;
  description: string;
  /** Icon hint for UI display */
  icon?: string;
  routeFamilies?: ToolRouteFamily[];
  operations: CapabilityOperation[];
}

// ─── Services interface (subset of AppContext needed by capabilities) ───

export interface CapabilityServices {
  dbProxy: {
    getPaper: (id: unknown) => Promise<unknown>;
    queryPapers: (filter: unknown) => Promise<unknown>;
    getAllConcepts: () => Promise<unknown>;
    getConcept: (id: unknown) => Promise<unknown>;
    getAnnotations: (paperId: unknown) => Promise<unknown>;
    getRelationGraph: (filter: unknown) => Promise<unknown>;
    getConceptMatrix: () => Promise<unknown>;
    getStats: () => Promise<unknown>;
    getMemosByEntity: (entityType: unknown, entityId: unknown) => Promise<unknown>;
    getAllNotes: () => Promise<unknown>;
    getNote: (id: unknown) => Promise<unknown>;
    queryNotes: (filter?: unknown) => Promise<unknown>;
    createNote: (note: unknown, chunks: unknown[], embeddings: unknown[]) => Promise<unknown>;
    updateNoteMeta: (id: unknown, updates: unknown) => Promise<unknown>;
    deleteNote: (id: unknown) => Promise<unknown>;
    getSuggestedConcepts: () => Promise<unknown>;
    addMemo?: (memo: unknown, embedding: unknown) => Promise<unknown>;
    addAnnotation?: (annotation: unknown) => Promise<unknown>;
    adoptSuggestedConcept?: (suggestionId: unknown, overrides?: unknown) => Promise<unknown>;
    dismissSuggestedConcept?: (suggestionId: unknown) => Promise<unknown>;
    adjudicateMapping?: (paperId: unknown, conceptId: unknown, decision: unknown, revisions?: unknown) => Promise<unknown>;
    getChunksByPaper?: (paperId: string) => Promise<unknown[]>;
  };
  searchService?: {
    searchSemanticScholar: (query: string, options?: { limit?: number }) => Promise<unknown>;
  } | null;
  ragService?: {
    searchSemantic: (query: string, topK?: number) => Promise<unknown>;
    retrieve: (request: Record<string, unknown>) => Promise<unknown>;
  } | null;
  orchestrator?: {
    start: (workflow: string, options: Record<string, unknown>) => { id: string };
  } | null;
  addPaper?: (paper: Record<string, unknown>) => Promise<string>;
  updatePaper?: (id: string, fields: Record<string, unknown>) => Promise<void>;
  pushManager?: {
    pushNotification: (n: { type: string; title: string; message: string }) => void;
  } | null;
  /** Callback for Level 2 operations requiring user confirmation */
  confirmWrite?: ((toolName: string, description: string, args: Record<string, unknown>) => Promise<boolean>) | null;
  /** Config provider for reading/updating settings */
  configProvider?: {
    config: Record<string, unknown>;
    update: (section: string, patch: Record<string, unknown>) => Promise<void>;
  } | null;
  apiDiagnostics?: {
    testProvider: (provider: string, apiKey?: string) => Promise<{ ok: boolean; message: string }>;
  } | null;
}

// ─── Tool bridge type (for converting capabilities to LLM tool definitions) ───

export interface CapabilityToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Which capability and operation this maps to */
  capabilityName: string;
  operationName: string;
  permissionLevel: PermissionLevel;
  routeFamilies: ToolRouteFamily[];
  /** Semantic relevance score (0-1) computed during routing. Higher = more relevant to user intent. */
  semanticRelevance?: number;
}
