/**
 * streaming-llm-helper — wraps completeStream for workflow usage.
 *
 * Consumes the async iterable, accumulates text_delta chunks,
 * pushes each chunk to the renderer via WorkflowRunnerContext,
 * and returns the final CompletionResult-compatible object.
 */

import type { LlmClient, CompleteParams, CompletionResult } from '../../llm-client/llm-client';
import type { WorkflowRunnerContext } from '../workflow-runner';

/**
 * Call LLM with streaming and push chunks to the renderer in real time.
 * Returns the same shape as `llmClient.complete()` so callers can swap in-place.
 */
export async function streamingComplete(
  llmClient: LlmClient,
  params: CompleteParams,
  runner: WorkflowRunnerContext,
): Promise<CompletionResult> {
  const helperStart = Date.now();
  const logger = runner.logger;
  logger.debug('[streamingComplete] Starting', {
    workflowId: params.workflowId ?? null,
    model: params.model ?? '(default)',
    signalAborted: runner.signal.aborted,
  });

  const stream = llmClient.completeStream(params);
  let fullText = '';
  let reasoning: string | null = null;
  let model = '';
  let usage = { inputTokens: 0, outputTokens: 0 };
  let finishReason: CompletionResult['finishReason'] = 'end_turn';
  let chunkCount = 0;
  let textDeltaCount = 0;
  let thinkingDeltaCount = 0;

  for await (const chunk of stream) {
    if (runner.signal.aborted) {
      logger.warn('[streamingComplete] Aborted by signal', {
        workflowId: params.workflowId,
        chunksProcessed: chunkCount,
        elapsedMs: Date.now() - helperStart,
      });
      break;
    }

    chunkCount++;

    switch (chunk.type) {
      case 'text_delta':
        textDeltaCount++;
        fullText += chunk.delta;
        runner.pushStreamChunk(chunk.delta, false);
        break;
      case 'thinking_delta':
        thinkingDeltaCount++;
        reasoning = (reasoning ?? '') + chunk.delta;
        break;
      case 'message_end':
        model = params.model ?? '';
        usage = chunk.usage;
        finishReason = chunk.finishReason;
        if (chunk.reasoning) reasoning = chunk.reasoning;
        runner.pushStreamChunk('', true);
        logger.info('[streamingComplete] Stream ended normally', {
          workflowId: params.workflowId,
          totalChunks: chunkCount,
          textDeltas: textDeltaCount,
          thinkingDeltas: thinkingDeltaCount,
          textLength: fullText.length,
          elapsedMs: Date.now() - helperStart,
          finishReason,
        });
        break;
      case 'error':
        runner.pushStreamChunk('', true);
        logger.error('[streamingComplete] Error chunk received', undefined, {
          workflowId: params.workflowId,
          code: chunk.code,
          message: chunk.message,
          chunksBeforeError: chunkCount,
          textDeltasBeforeError: textDeltaCount,
          thinkingDeltasBeforeError: thinkingDeltaCount,
          elapsedMs: Date.now() - helperStart,
        });
        throw new Error(`LLM stream error [${chunk.code}]: ${chunk.message}`);
    }
  }

  return {
    text: fullText,
    toolCalls: [],
    model,
    usage,
    finishReason,
    reasoning,
  };
}
