/**
 * EditorExecutor — applies structured patches to the editor.
 *
 * All patches go through reconciliation before apply.
 * If reconciliation fails, the patch is degraded to preview or chat-message.
 */

import type {
  CopilotOperation,
  EditorPatch,
  PatchPrecondition,
  ReconciliationResult,
  OutputTarget,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';

export interface EditorExecutorDeps {
  /**
   * Reconcile a patch against the current editor state.
   * Returns whether the patch is still safe to apply.
   */
  reconcile: (patch: EditorPatch) => Promise<ReconciliationResult>;

  /**
   * Apply a patch to the editor.
   * Only called after reconciliation succeeds.
   */
  applyPatch: (patch: EditorPatch) => Promise<void>;

  /**
   * Persist the document after patch application.
   */
  persistDocument?: (articleId: string, sectionId?: string) => Promise<void>;
}

export interface EditorExecutorResult {
  applied: boolean;
  patch: EditorPatch;
  reconciliation: ReconciliationResult;
  fallbackTarget?: OutputTarget;
}

export class EditorExecutor {
  private deps: EditorExecutorDeps;

  constructor(deps: EditorExecutorDeps) {
    this.deps = deps;
  }

  async execute(
    operation: CopilotOperation,
    patch: EditorPatch,
    emitter: OperationEventEmitter,
    signal?: AbortSignal,
  ): Promise<EditorExecutorResult> {
    // Step 1: Propose
    emitter.emit({
      type: 'patch.proposed',
      operationId: operation.id,
      patch,
    });

    if (signal?.aborted) {
      return { applied: false, patch, reconciliation: { ok: false, reason: 'editor_changed' } };
    }

    // Step 2: Reconcile
    const reconciliation = await this.deps.reconcile(patch);

    if (!reconciliation.ok) {
      // Patch is stale — do not apply
      return {
        applied: false,
        patch,
        reconciliation,
        fallbackTarget: reconciliation.fallbackTarget ?? { type: 'chat-message' },
      };
    }

    // Step 3: Apply
    try {
      await this.deps.applyPatch(patch);

      emitter.emit({
        type: 'patch.applied',
        operationId: operation.id,
        patch,
      });

      // Step 4: Persist
      if (this.deps.persistDocument) {
        const preconditions = extractPreconditions(patch);
        if (preconditions) {
          try {
            await this.deps.persistDocument(
              preconditions.articleId,
              preconditions.sectionId ?? undefined,
            );
            emitter.emit({
              type: 'persistence.succeeded',
              operationId: operation.id,
            });
          } catch (err) {
            emitter.emit({
              type: 'persistence.failed',
              operationId: operation.id,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return {
        applied: true,
        patch,
        reconciliation,
      };
    } catch {
      // Transaction failed
      return {
        applied: false,
        patch,
        reconciliation: {
          ok: false,
          reason: 'editor_changed',
          fallbackTarget: { type: 'chat-message' },
        },
      };
    }
  }
}

function extractPreconditions(patch: EditorPatch): PatchPrecondition | undefined {
  return patch.preconditions;
}
