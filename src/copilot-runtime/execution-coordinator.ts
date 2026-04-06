/**
 * ExecutionCoordinator — the linear main chain of Copilot Runtime.
 *
 * Calls Router → Context Builder → Recipe → Executors in strict sequence.
 * Maintains request-scoped operation state.
 * Emits observation events after each phase (side-channel, not control flow).
 * Captures errors and writes structured trace.
 *
 * This is the ONLY place that orchestrates execution.
 * Events are emitted AFTER each step, not used to drive the next step.
 */

import type {
  CopilotOperation,
  CopilotOperationEnvelope,
  CopilotExecuteResult,
  ContextSnapshot,
  ExecutionPlan,
  ExecutionStep,
  OutputTarget,
  EditorPatch,
  ClarificationRequest,
  ClarificationOption,
  ResumeOperationRequest,
  OperationRecipe,
  DegradationRecord,
  JSONContent,
} from './types';
import type { IntentRouter, IntentClassification } from './intent-router';
import type { ContextSnapshotBuilder } from './context-builder';
import type { RecipeRegistry } from './recipe-registry';
import type { OperationEventEmitter } from './event-emitter';
import type { TraceStore } from './trace-store';
import type { CopilotSessionManager } from './session-manager';
import { IdempotencyGuard } from './idempotency-guard';
import type { ConfirmationEvaluator } from './confirmation';
import type { FailurePolicyEvaluator } from './failure-policy';
import type { AgentExecutor, AgentExecutorResult } from './executors/agent-executor';
import type { RetrievalExecutor, RetrievalExecutorResult } from './executors/retrieval-executor';
import type { EditorExecutor } from './executors/editor-executor';
import type { WorkflowExecutor } from './executors/workflow-executor';
import type { NavigationExecutor } from './executors/navigation-executor';
import * as crypto from 'node:crypto';

export interface ExecutionCoordinatorDeps {
  router: IntentRouter;
  contextBuilder: ContextSnapshotBuilder;
  recipeRegistry: RecipeRegistry;
  emitter: OperationEventEmitter;
  traceStore: TraceStore;
  sessionManager: CopilotSessionManager;
  idempotencyGuard: IdempotencyGuard;
  confirmationEvaluator: ConfirmationEvaluator;
  failurePolicy: FailurePolicyEvaluator;
  agentExecutor: AgentExecutor;
  retrievalExecutor: RetrievalExecutor;
  editorExecutor: EditorExecutor;
  workflowExecutor: WorkflowExecutor;
  navigationExecutor: NavigationExecutor;
  logger?: (msg: string, data?: unknown) => void;
}

/** Active abort controllers for in-flight operations */
const abortControllers = new Map<string, AbortController>();

/** Intents that always apply patches directly to the editor (never defer to chat buttons). */
const EDITOR_MUTATION_INTENTS = new Set([
  'rewrite-selection', 'expand-selection', 'compress-selection', 'continue-writing',
]);

class OperationAbortedError extends Error {
  code = 'OPERATION_ABORTED';

  constructor() {
    super('Operation aborted');
    this.name = 'OperationAbortedError';
  }
}

export class ExecutionCoordinator {
  private deps: ExecutionCoordinatorDeps;

  constructor(deps: ExecutionCoordinatorDeps) {
    this.deps = deps;
  }

  /**
   * Execute a copilot operation — the main linear chain.
   *
   * normalize → context → recipe → plan → execute → result
   */
  async execute(envelope: CopilotOperationEnvelope): Promise<CopilotExecuteResult> {
    // ── Phase 0: Normalize ──
    const operation = this.normalizeOperation(envelope);
    let currentOperation = operation;
    const { traceStore, emitter, sessionManager, idempotencyGuard } = this.deps;
    const skipIdempotency = envelope.options?.skipIdempotency === true;

    if (!skipIdempotency) {
      // Idempotency check
      const fingerprint = IdempotencyGuard.buildFingerprint(
        operation.surface,
        operation.prompt,
        operation.context?.selection?.kind === 'editor'
          ? operation.context.selection.selectedText
          : operation.context?.selection?.kind === 'reader'
            ? operation.context.selection.selectedText
            : undefined,
      );

      const duplicate = idempotencyGuard.checkDuplicate({
        operationId: operation.id,
        surface: operation.surface,
        fingerprint,
        dedupeWindowMs: 1200,
      });

      if (duplicate) {
        return { operationId: duplicate, sessionId: operation.sessionId };
      }

      idempotencyGuard.register({
        operationId: operation.id,
        surface: operation.surface,
        fingerprint,
        dedupeWindowMs: 1200,
      });
    }

    // Setup abort controller
    const abortController = new AbortController();
    abortControllers.set(operation.id, abortController);
    const signal = abortController.signal;

    // Create trace
    traceStore.createTrace(operation.id, operation.sessionId);
    traceStore.startPhase(operation.id, 'normalize');

    // Track in session
    sessionManager.trackOperation(operation);

    // Emit started event
    emitter.emit({
      type: 'operation.started',
      operationId: operation.id,
      sessionId: operation.sessionId,
      intent: operation.intent,
    });

    traceStore.completePhase(operation.id, 'normalize');

    try {
      // ── Phase 1: Route intent ──
      traceStore.startPhase(operation.id, 'context');

      const classification = await this.deps.router.classify(operation);


      // Update operation with routed intent and target
      const routedOperation: CopilotOperation = {
        ...operation,
        intent: classification.intent,
        outputTarget: classification.outputTarget,
      };
      currentOperation = routedOperation;

      // Handle ambiguous intent → ask for clarification
      if (classification.ambiguous && classification.alternatives) {
        return this.handleClarification(
          routedOperation,
          '请选择您想要执行的操作',
          [
            {
              id: classification.intent,
              label: this.intentLabel(classification.intent),
              targetIntent: classification.intent,
            },
            ...classification.alternatives.map((alt) => ({
              id: alt.intent,
              label: this.intentLabel(alt.intent),
              targetIntent: alt.intent,
            })),
          ],
        );
      }

      // ── Phase 2: Build context ──
      const context = await this.deps.contextBuilder.build(routedOperation);
      const contextualOperation: CopilotOperation = {
        ...routedOperation,
        context,
      };
      currentOperation = contextualOperation;
      sessionManager.trackOperation(contextualOperation);

      emitter.emit({
        type: 'context.resolved',
        operationId: operation.id,
        summary: `View: ${context.activeView}, Selection: ${context.selection?.kind ?? 'none'}`,
      });

      traceStore.completePhase(operation.id, 'context');

      // ── Phase 3: Resolve recipe ──
      traceStore.startPhase(operation.id, 'recipe');

      const resolution = this.deps.recipeRegistry.resolve(contextualOperation, context);

      if (!resolution.selected) {
        // Multiple recipes tied → ask user to pick
        if (resolution.resolution === 'deferred_to_user' && resolution.candidates.length > 0) {
          return this.handleClarification(
            contextualOperation,
            '多个操作匹配，请选择具体动作',
            resolution.candidates.map((id) => ({ id, label: id })),
          );
        }

        // No recipe matched → fallback to plain chat
        traceStore.failPhase(operation.id, 'recipe', {
          code: 'NO_RECIPE',
          message: 'No recipe matched',
        });

        return this.fallbackToChat(contextualOperation, signal);
      }

      traceStore.completePhase(operation.id, 'recipe', {
        recipeId: resolution.selected.id,
        resolution: resolution.resolution,
      });

      // ── Phase 4: Build plan ──
      traceStore.startPhase(operation.id, 'plan');

      const plan = await resolution.selected.buildPlan(contextualOperation, context);

      // Evaluate confirmation policy
      const confirmation = this.deps.confirmationEvaluator.evaluate(contextualOperation);
      plan.confirmation = confirmation;

      emitter.emit({
        type: 'planning.finished',
        operationId: operation.id,
        steps: plan.steps.map((s) => s.kind),
      });

      traceStore.completePhase(operation.id, 'plan', {
        steps: plan.steps.map((s) => s.kind),
      });

      // ── Phase 5: Execute plan ──
      traceStore.startPhase(operation.id, 'execute');

      const result = await this.executePlan(plan, contextualOperation, signal);
      this.throwIfAborted(signal);

      traceStore.completePhase(operation.id, 'execute');

      // ── Finalize ──
      emitter.emit({
        type: 'operation.completed',
        operationId: operation.id,
        ...(result.summary ? { resultSummary: result.summary } : {}),
      });

      traceStore.finalizeTrace(
        operation.id,
        'completed',
        currentOperation.intent,
        currentOperation.surface,
        resolution.selected.id,
      );

      return { operationId: operation.id, sessionId: operation.sessionId };
    } catch (err) {
      if (this.isAbortError(err, signal)) {
        emitter.emit({
          type: 'operation.aborted',
          operationId: operation.id,
        });

        traceStore.finalizeTrace(
          operation.id,
          'aborted',
          currentOperation.intent,
          currentOperation.surface,
        );

        return { operationId: operation.id, sessionId: operation.sessionId };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = err instanceof Error && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'EXECUTION_ERROR';

      this.deps.logger?.(`Operation ${operation.id} failed: ${errMsg}`);

      emitter.emit({
        type: 'operation.failed',
        operationId: operation.id,
        code: errCode,
        message: errMsg,
      });

      traceStore.finalizeTrace(
        operation.id,
        'failed',
        currentOperation.intent,
        currentOperation.surface,
      );

      return { operationId: operation.id, sessionId: operation.sessionId };
    } finally {
      abortControllers.delete(operation.id);
      idempotencyGuard.release(operation.id);
      idempotencyGuard.cleanup();
      emitter.releaseOperation(operation.id);
    }
  }

  /**
   * Abort an in-flight operation.
   */
  abort(operationId: string): void {
    const controller = abortControllers.get(operationId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Resume a clarification-paused operation.
   */
  async resume(request: ResumeOperationRequest): Promise<CopilotExecuteResult> {
    const sessionId = this.getSessionForOperation(request.operationId);
    if (!sessionId) {
      throw new Error(`No session found for operation ${request.operationId}`);
    }

    const session = this.deps.sessionManager.get(sessionId);
    if (!session?.pendingClarification) {
      throw new Error(`No pending clarification for operation ${request.operationId}`);
    }

    const clarification = session.pendingClarification;

    // Validate token
    if (clarification.continuationToken !== request.continuationToken) {
      throw new Error('Invalid continuation token');
    }

    // Validate expiry
    if (clarification.expiresAt && Date.now() > clarification.expiresAt) {
      throw new Error('Clarification expired');
    }

    // Find the selected option
    const selected = clarification.options.find((o) => o.id === request.selectedOptionId);
    if (!selected) {
      throw new Error(`Unknown option: ${request.selectedOptionId}`);
    }

    // Clear clarification
    this.deps.sessionManager.clearPendingClarification(session.id);

    // Rebuild operation with the selected intent/recipe
    const resumeOperation = clarification.resumeOperation;

    const resumedOperation: CopilotOperation = {
      ...resumeOperation,
      id: request.operationId,
      sessionId: session.id,
      intent: selected.targetIntent ?? resumeOperation.intent,
    };

    // Re-execute with the clarified intent (skip router)
    return this.execute({
      operation: resumedOperation,
      options: { skipIdempotency: true },
    });
  }

  // ─── Internal ───

  private normalizeOperation(envelope: CopilotOperationEnvelope): CopilotOperation {
    const op = envelope.operation;
    return {
      ...op,
      id: op.id || crypto.randomUUID(),
      sessionId: op.sessionId || 'workspace',
      context: op.context ?? {
        activeView: 'library',
        workspaceId: '',
        article: null,
        selection: null,
        focusEntities: { paperIds: [], conceptIds: [] },
        conversation: { recentTurns: [] },
        retrieval: { evidence: [] },
        writing: null,
        budget: { policy: 'standard', tokenBudget: 6000, includedLayers: ['surface', 'working'] },
        frozenAt: Date.now(),
      },
    };
  }

  private async executePlan(
    plan: ExecutionPlan,
    initialOperation: CopilotOperation,
    signal: AbortSignal,
  ): Promise<{ summary?: string }> {
    let lastText = '';
    let retrievalResults: RetrievalExecutorResult | undefined;
    let operation = initialOperation;

    for (const step of plan.steps) {
      this.throwIfAborted(signal);

      switch (step.kind) {
        case 'retrieve': {
          try {
            retrievalResults = await this.deps.retrievalExecutor.execute(
              operation, step, this.deps.emitter, signal,
            );
            this.throwIfAborted(signal);
            // Enrich operation context with retrieval results.
            // context may be frozen (Object.freeze in ContextSnapshotBuilder),
            // so we replace it with a shallow copy before mutation.
            operation = {
              ...operation,
              context: {
                ...operation.context,
                retrieval: {
                  evidence: retrievalResults.evidence,
                  lastQuery: retrievalResults.query,
                },
              },
            };
          } catch (err) {
            const policy = this.deps.failurePolicy.evaluate('retrieval');
            const degradation: DegradationRecord = {
              stage: 'retrieval',
              mode: policy.degradation,
              reason: err instanceof Error ? err.message : String(err),
              preservedArtifacts: [],
            };
            this.deps.traceStore.addDegradation(operation.id, degradation);

            if (operation.constraints?.requireCitation) {
              throw err; // Cannot continue without evidence
            }
            // Continue without evidence
          }
          break;
        }

        case 'llm_generate': {
          const result = await this.deps.agentExecutor.execute(
            operation, step, this.deps.emitter, signal,
          );
          this.throwIfAborted(signal);
          lastText = result.text;
          break;
        }

        case 'validate_citation': {
          // Citation validation is done inline during generation
          break;
        }

        case 'apply_patch': {
          if (lastText && step.patchTarget.type !== 'chat-message') {
            const patch = this.textToPatch(lastText, step.patchTarget, operation);
            if (patch) {
              // Direct editor mutations (rewrite/expand/compress/continue) always
              // go straight to the editor preview — never deferred to chat buttons.
              // Only heavyweight / non-editor operations use the chat deferred path.
              const isEditorMutation = EDITOR_MUTATION_INTENTS.has(operation.intent);
              const confirmMode = plan.confirmation?.mode;
              const shouldDefer = !isEditorMutation &&
                (confirmMode === 'explicit' || (confirmMode === 'preview' && operation.surface === 'chat'));

              if (shouldDefer) {
                // Emit deferred patch event — renderer stores on chat message
                this.deps.emitter.emit({
                  type: 'patch.deferred',
                  operationId: operation.id,
                  patch,
                  summary: this.buildPatchSummary(patch, operation),
                });
              } else {
                const editorResult = await this.deps.editorExecutor.execute(
                  operation, patch, this.deps.emitter, signal,
                );
                this.throwIfAborted(signal);

                if (!editorResult.applied) {
                  const degradation: DegradationRecord = {
                    stage: 'patch_reconciliation',
                    mode: 'fallback_to_patch_preview',
                    reason: editorResult.reconciliation.reason ?? 'unknown',
                    preservedArtifacts: ['patch'],
                  };
                  this.deps.traceStore.addDegradation(operation.id, degradation);
                }
              }
            }
          }
          break;
        }

        case 'run_workflow': {
          const wfResult = await this.deps.workflowExecutor.execute(
            operation, step, this.deps.emitter, signal,
          );
          this.throwIfAborted(signal);
          if (!wfResult.success) {
            const degradation: DegradationRecord = {
              stage: 'workflow_execution',
              mode: 'return_partial_result',
              reason: wfResult.error ?? 'Workflow failed',
            };
            this.deps.traceStore.addDegradation(operation.id, degradation);
          }
          break;
        }

        case 'navigate': {
          await this.deps.navigationExecutor.execute(
            operation, step, this.deps.emitter, signal,
          );
          this.throwIfAborted(signal);
          break;
        }
      }
    }

    return { summary: lastText ? lastText.substring(0, 200) : '' };
  }

  private async fallbackToChat(
    operation: CopilotOperation,
    signal: AbortSignal,
  ): Promise<CopilotExecuteResult> {
    // Try RAG-enriched fallback: retrieve evidence first, then chat with context.
    // This ensures queries like "这篇论文的方法论有什么问题？" still get RAG support
    // even when no recipe matches.
    let enrichedOperation = operation;
    try {
      this.throwIfAborted(signal);
      const retrievalResult = await this.deps.retrievalExecutor.execute(
        operation,
        { kind: 'retrieve', query: operation.prompt, source: 'rag' },
        this.deps.emitter,
        signal,
      );
      if (retrievalResult.evidence.length > 0) {
        enrichedOperation = {
          ...operation,
          context: {
            ...operation.context,
            retrieval: {
              evidence: retrievalResult.evidence,
              lastQuery: retrievalResult.query,
            },
          },
        };
      }
    } catch (err) {
      // Retrieval failed — continue without evidence (pure chat)
      this.deps.logger?.('Retrieval failed in fallbackToChat, continuing without evidence', {
        operationId: operation.id,
        error: (err as Error).message,
      });
    }

    this.throwIfAborted(signal);
    const step = { kind: 'llm_generate' as const, mode: 'chat' as const };
    const result = await this.deps.agentExecutor.execute(enrichedOperation, step, this.deps.emitter, signal);
    this.throwIfAborted(signal);

    this.deps.emitter.emit({
      type: 'operation.completed',
      operationId: operation.id,
      ...(result.text ? { resultSummary: result.text.substring(0, 200) } : {}),
    });

    this.deps.traceStore.finalizeTrace(
      operation.id, 'completed', operation.intent, operation.surface,
    );

    return { operationId: operation.id, sessionId: operation.sessionId };
  }

  private handleClarification(
    operation: CopilotOperation,
    question: string,
    options: ClarificationOption[],
  ): CopilotExecuteResult {
    const token = crypto.randomUUID();
    const clarification: ClarificationRequest = {
      operationId: operation.id,
      sessionId: operation.sessionId,
      question,
      options,
      resumeOperation: operation,
      continuationToken: token,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    };

    this.deps.sessionManager.setPendingClarification(operation.sessionId, clarification);

    // Emit clarification as a chat-message style event
    this.deps.emitter.emit({
      type: 'model.delta',
      operationId: operation.id,
      channel: 'chat',
      text: `${question}\n\n${options.map((o) => `- ${o.label}`).join('\n')}`,
    });

    this.deps.emitter.emit({
      type: 'operation.clarification_required',
      operationId: operation.id,
      question,
      options,
    });

    return { operationId: operation.id, sessionId: operation.sessionId };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new OperationAbortedError();
    }
  }

  private isAbortError(err: unknown, signal: AbortSignal): boolean {
    return signal.aborted || err instanceof OperationAbortedError;
  }

  private textToPatch(
    text: string,
    target: OutputTarget,
    operation: CopilotOperation,
  ): EditorPatch | null {
    const content: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    };

    switch (target.type) {
      case 'editor-selection-replace':
        return {
          kind: 'replace-range',
          editorId: target.editorId,
          from: target.from,
          to: target.to,
          content,
          preconditions: {
            articleId: target.articleId,
            sectionId: target.sectionId,
            editorId: target.editorId,
            expectedSelection: { from: target.from, to: target.to },
          },
        };

      case 'editor-insert-after':
        return {
          kind: 'insert-at',
          editorId: target.editorId,
          pos: target.pos,
          content,
          preconditions: {
            articleId: target.articleId,
            sectionId: target.sectionId,
            editorId: target.editorId,
          },
        };

      case 'section-replace':
        return {
          kind: 'replace-section',
          editorId: 'main',
          sectionId: target.sectionId,
          content,
          preconditions: {
            articleId: target.articleId,
            sectionId: target.sectionId,
            editorId: 'main',
          },
        };

      case 'section-append':
        return {
          kind: 'insert-at',
          editorId: 'main',
          pos: -1, // append
          content,
          preconditions: {
            articleId: target.articleId,
            sectionId: target.sectionId,
            editorId: 'main',
          },
        };

      default:
        return null;
    }
  }

  private intentLabel(intent: string): string {
    const labels: Record<string, string> = {
      'ask': '对话提问',
      'rewrite-selection': '改写选区',
      'expand-selection': '扩展选区',
      'compress-selection': '压缩选区',
      'continue-writing': '续写',
      'generate-section': '生成章节',
      'insert-citation-sentence': '插入引用句',
      'draft-citation': '生成引用',
      'summarize-selection': '总结选区',
      'summarize-section': '总结章节',
      'review-argument': '审查论证',
      'retrieve-evidence': '检索证据',
      'navigate': '导航',
      'run-workflow': '运行工作流',
    };
    return labels[intent] ?? intent;
  }

  private getSessionForOperation(operationId: string): string | null {
    // Direct lookup via session manager (populated by trackOperation)
    const direct = this.deps.sessionManager.getSessionIdForOperation(operationId);
    if (direct) return direct;

    // Fallback: search timeline
    for (const summary of this.deps.sessionManager.list()) {
      const session = this.deps.sessionManager.get(summary.id);
      if (session?.timeline.some((e) => e.operationId === operationId)) {
        return summary.id;
      }
    }
    return null;
  }

  private buildPatchSummary(patch: EditorPatch, operation: CopilotOperation): string {
    const intent = this.intentLabel(operation.intent);
    switch (patch.kind) {
      case 'replace-range':
        return `${intent}：替换选区内容`;
      case 'insert-at':
        return `${intent}：插入新内容`;
      case 'replace-section':
        return `${intent}：替换整节内容`;
      default:
        return `${intent}：编辑器更新`;
    }
  }
}
