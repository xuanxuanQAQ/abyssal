/**
 * CopilotRuntime — the unified AI runtime.
 *
 * Single entry point: execute(envelope) → result
 *
 * Composes all internal components:
 *   IntentRouter → ContextSnapshotBuilder → RecipeRegistry →
 *   ExecutionCoordinator → Executors → EventEmitter → TraceStore
 *
 * Replaces SessionOrchestrator as the top-level AI kernel.
 */

import type {
  CopilotOperationEnvelope,
  CopilotExecuteResult,
  CopilotSessionSummary,
  CopilotSessionState,
  OperationStatusSnapshot,
  ResumeOperationRequest,
  CopilotOperationEvent,
  OperationRecipe,
} from './types';
import { IntentRouter } from './intent-router';
import { ContextSnapshotBuilder, type ContextBuildDeps } from './context-builder';
import { RecipeRegistry } from './recipe-registry';
import { ExecutionCoordinator, type ExecutionCoordinatorDeps } from './execution-coordinator';
import { OperationEventEmitter, type CopilotEventListener } from './event-emitter';
import { CopilotSessionManager } from './session-manager';
import { TraceStore } from './trace-store';
import { IdempotencyGuard } from './idempotency-guard';
import { ConfirmationEvaluator } from './confirmation';
import { FailurePolicyEvaluator } from './failure-policy';
import { AgentExecutor, type AgentExecutorDeps } from './executors/agent-executor';
import { RetrievalExecutor, type RetrievalExecutorDeps } from './executors/retrieval-executor';
import { EditorExecutor, type EditorExecutorDeps } from './executors/editor-executor';
import { WorkflowExecutor, type WorkflowExecutorDeps } from './executors/workflow-executor';
import { NavigationExecutor, type NavigationExecutorDeps } from './executors/navigation-executor';
import { builtinRecipes } from './recipes';

export interface CopilotRuntimeDeps {
  context: ContextBuildDeps;
  agent: AgentExecutorDeps;
  retrieval: RetrievalExecutorDeps;
  editor: EditorExecutorDeps;
  workflow: WorkflowExecutorDeps;
  navigation: NavigationExecutorDeps;
  logger?: (msg: string, data?: unknown) => void;
}

export class CopilotRuntime {
  private coordinator: ExecutionCoordinator;
  private emitter: OperationEventEmitter;
  private sessionManager: CopilotSessionManager;
  private traceStore: TraceStore;
  private recipeRegistry: RecipeRegistry;

  constructor(deps: CopilotRuntimeDeps) {
    const router = new IntentRouter();
    const contextBuilder = new ContextSnapshotBuilder(deps.context);
    const recipeRegistry = new RecipeRegistry();
    const emitter = new OperationEventEmitter();
    const traceStore = new TraceStore();
    const sessionManager = new CopilotSessionManager();
    const idempotencyGuard = new IdempotencyGuard();
    const confirmationEvaluator = new ConfirmationEvaluator();
    const failurePolicy = new FailurePolicyEvaluator();

    const agentExecutor = new AgentExecutor(deps.agent);
    const retrievalExecutor = new RetrievalExecutor(deps.retrieval);
    const editorExecutor = new EditorExecutor(deps.editor);
    const workflowExecutor = new WorkflowExecutor(deps.workflow);
    const navigationExecutor = new NavigationExecutor(deps.navigation);

    this.coordinator = new ExecutionCoordinator({
      router,
      contextBuilder,
      recipeRegistry,
      emitter,
      traceStore,
      sessionManager,
      idempotencyGuard,
      confirmationEvaluator,
      failurePolicy,
      agentExecutor,
      retrievalExecutor,
      editorExecutor,
      workflowExecutor,
      navigationExecutor,
      ...(deps.logger ? { logger: deps.logger } : {}),
    });

    this.emitter = emitter;
    this.sessionManager = sessionManager;
    this.traceStore = traceStore;
    this.recipeRegistry = recipeRegistry;

    // Wire emitter → session manager so events populate the timeline
    emitter.on((event) => {
      sessionManager.appendEvent(event);
    });

    // Register built-in recipes
    for (const recipe of builtinRecipes) {
      recipeRegistry.register(recipe);
    }
  }

  // ─── Primary API ───

  async execute(envelope: CopilotOperationEnvelope): Promise<CopilotExecuteResult> {
    return this.coordinator.execute(envelope);
  }

  abort(operationId: string): void {
    this.coordinator.abort(operationId);
  }

  async resume(request: ResumeOperationRequest): Promise<CopilotExecuteResult> {
    return this.coordinator.resume(request);
  }

  // ─── Session API ───

  listSessions(): CopilotSessionSummary[] {
    return this.sessionManager.list();
  }

  getSession(sessionId: string): CopilotSessionState | null {
    return this.sessionManager.get(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessionManager.clear(sessionId);
  }

  getOperationStatus(operationId: string): OperationStatusSnapshot | null {
    return this.sessionManager.getOperationStatus(operationId);
  }

  // ─── Event subscription ───

  onEvent(listener: CopilotEventListener): () => void {
    return this.emitter.on(listener);
  }

  // ─── Recipe management ───

  registerRecipe(recipe: OperationRecipe): void {
    this.recipeRegistry.register(recipe);
  }

  // ─── Diagnostics ───

  getRecentTraces(limit?: number) {
    return this.traceStore.getRecentTraces(limit);
  }

  getTraceSummaries(limit?: number) {
    return this.traceStore.getSummaries(limit);
  }
}
