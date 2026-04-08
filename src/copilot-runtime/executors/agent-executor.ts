/**
 * AgentExecutor — interfaces with LLM + tool calling.
 *
 * Implements the unified executor interface for tool-use conversation loops.
 */

import type { LlmClient } from '../../adapter/llm-client/llm-client';
import type { CapabilityRegistry } from '../../adapter/capabilities';
import type { ResearchSession } from '../../core/session/research-session';
import type { EventBus } from '../../core/event-bus';
import type { ToolCallingGovernor } from '../../adapter/orchestrator/tool-calling-governor';
import { classifyPromptGate } from '../../adapter/orchestrator/prompt-injection-gating';
import { routeToolFamilies, buildToolRouteInstruction } from '../../adapter/orchestrator/tool-routing';
import type { ToolRouteFamily } from '../../adapter/capabilities/types';
import type {
  CopilotOperation,
  ExecutionStep,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';
import type { OperationResult } from '../../adapter/capabilities/types';

export interface AgentExecutorDeps {
  llmClient: LlmClient;
  capabilities: CapabilityRegistry;
  session: ResearchSession;
  eventBus: EventBus;
  governor: ToolCallingGovernor;
  buildSystemPrompt: (operation: CopilotOperation) => Promise<string>;
  logger?: (msg: string, data?: unknown) => void;
}

export interface AgentExecutorResult {
  text: string;
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: string;
    status: 'completed' | 'failed';
  }>;
  usage: { inputTokens: number; outputTokens: number };
}

export class AgentExecutor {
  private deps: AgentExecutorDeps;
  private log: (msg: string, data?: unknown) => void;

  constructor(deps: AgentExecutorDeps) {
    this.deps = deps;
    this.log = deps.logger ?? (() => {});
  }

  async execute(
    operation: CopilotOperation,
    step: ExecutionStep & { kind: 'llm_generate' },
    emitter: OperationEventEmitter,
    signal?: AbortSignal,
  ): Promise<AgentExecutorResult> {
    let systemPrompt = await this.deps.buildSystemPrompt(operation);

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Conversation history injection depends on step mode:
    //   chat  → full history (all recent turns)
    //   draft → last 2 turns only (enough for "make it more academic" follow-ups,
    //           not enough to pollute with unrelated tool calls / research chat)
    //   patch → no history (pure generation)
    const maxHistoryTurns = step.mode === 'chat' ? Infinity
      : step.mode === 'draft' ? 2
      : 0;
    const recentTurns = operation.context.conversation.recentTurns
      .filter((t) => t.role === 'user' || t.role === 'assistant');
    const historySlice = maxHistoryTurns === Infinity
      ? recentTurns
      : recentTurns.slice(-maxHistoryTurns);
    for (const turn of historySlice) {
      messages.push({ role: turn.role as 'user' | 'assistant', content: turn.text });
    }

    // Add the current prompt
    const userPrompt = buildPromptWithContext(operation);
    messages.push({ role: 'user', content: userPrompt });

    // Route tool families based on user intent
    const promptGate = classifyPromptGate({
      userMessage: operation.prompt,
      hasRecentSelection: operation.context.selection !== null,
    });
    const disableToolUse = promptGate.type === 'greeting' || promptGate.type === 'smalltalk' || promptGate.type === 'assistant-profile';

    // Step-level allowedToolFamilies (from recipe) take precedence over routing
    const stepFamilies = step.allowedToolFamilies;
    const route = routeToolFamilies({ userMessage: operation.prompt, gateType: promptGate.type });
    const effectiveFamilies: ToolRouteFamily[] = stepFamilies ?? route.allowedFamilies;
    const tools = disableToolUse
      ? []
      : this.deps.capabilities.toToolDefinitions({
          allowedFamilies: effectiveFamilies,
          userMessage: operation.prompt,
        });

    // Inject routing instruction only for open-ended chat — skip for recipe-
    // constrained steps (stepFamilies set) and draft/patch modes to avoid
    // prompting the model toward tool use during focused generation.
    if (!disableToolUse && !stepFamilies && step.mode === 'chat' && route.confidence >= 0.75) {
      systemPrompt += `\n\n${buildToolRouteInstruction(route)}`;
    }

    // draft and patch modes are pure text generation — no tool use.
    // draft = editor mutations (rewrite, expand, compress, continue-writing)
    // patch = raw text patching
    const allowToolUse = step.mode === 'chat' && !disableToolUse;

    this.log('[AgentExecutor] setup', {
      operationId: operation.id,
      intent: operation.intent,
      stepMode: step.mode,
      gateType: promptGate.type,
      disableToolUse,
      allowToolUse,
      routePrimaryFamily: route.primaryFamily,
      routeAllowedFamilies: route.allowedFamilies,
      routeConfidence: route.confidence,
      routeReason: route.reason,
      effectiveFamilies,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      hasStepFamilies: !!stepFamilies,
      useReasoning: operation.metadata?.reasoning === true,
      promptPreview: operation.prompt.slice(0, 100),
      selectionKind: operation.context?.selection?.kind ?? null,
      channel: step.mode === 'chat' ? 'chat' : 'draft',
    });

    // Reset governor for this operation
    this.deps.governor.reset();

    let fullText = '';
    const toolCalls: AgentExecutorResult['toolCalls'] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let round = 0;
    const maxRounds = 15;

    // Estimate total message size for debug logging
    const estimateMessagesSize = (msgs: Array<{ content: string }>): number =>
      msgs.reduce((sum, m) => sum + m.content.length, 0);

    while (round < maxRounds) {
      round++;

      if (signal?.aborted) {
        break;
      }

      const roundStartTime = Date.now();
      const msgChars = estimateMessagesSize(messages) + systemPrompt.length;
      this.log('[AgentExecutor] round start', {
        round,
        maxRounds,
        systemPromptChars: systemPrompt.length,
        messageCount: messages.length,
        totalContextChars: msgChars,
        toolCount: tools.length,
        allowToolUse,
      });

      const useReasoning = operation.metadata?.reasoning === true;
      const stream = this.deps.llmClient.completeStream({
        systemPrompt,
        messages,
        workflowId: useReasoning ? 'agent.reasoning' : 'agent',
        ...(useReasoning ? { thinkingBudget: 10240 } : {}),
        ...(allowToolUse && tools.length > 0 ? { tools } : {}),
        ...(signal ? { signal } : {}),
      });

      let roundText = '';
      const roundToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        switch (chunk.type) {
          case 'thinking_delta':
            emitter.emit({
              type: 'model.thinking_delta',
              operationId: operation.id,
              text: chunk.delta,
            });
            break;

          case 'text_delta':
            roundText += chunk.delta;
            emitter.emit({
              type: 'model.delta',
              operationId: operation.id,
              channel: step.mode === 'chat' ? 'chat' : 'draft',
              text: chunk.delta,
            });
            break;

          case 'tool_use_start':
          case 'tool_use_delta':
            break;

          case 'tool_use_end':
            roundToolCalls.push({
              id: chunk.id,
              name: chunk.name,
              input: chunk.input,
            });
            break;

          case 'message_end':
            totalInput += chunk.usage?.inputTokens ?? 0;
            totalOutput += chunk.usage?.outputTokens ?? 0;
            break;

          case 'error': {
            this.log('[AgentExecutor] LLM error in round', {
              round,
              code: chunk.code,
              message: chunk.message,
              roundElapsedMs: Date.now() - roundStartTime,
              contextChars: msgChars,
              messageCount: messages.length,
              toolCount: tools.length,
              accumulatedTextLength: fullText.length + roundText.length,
              pendingToolCalls: roundToolCalls.length,
            });
            const err = new Error(
              chunk.code === 'CONTENT_FILTERED'
                ? `模型内容安全审核拒绝了此请求。建议：1) 用英文关键词重试；2) 简化查询内容；3) 切换其他模型。\n(原始错误: ${chunk.message})`
                : `LLM error: [${chunk.code}] ${chunk.message}`,
            );
            (err as unknown as Record<string, unknown>)['code'] = chunk.code;
            throw err;
          }
        }
      }

      fullText += roundText;

      // No tool calls → done
      if (roundToolCalls.length === 0) {
        break;
      }

      // Push the assistant's text ONCE before executing any tool calls.
      // Previously this was inside the loop, causing duplicate assistant messages
      // when a round had multiple tool calls.
      messages.push({ role: 'assistant', content: roundText });

      // Execute tool calls — collect all results, then push as a single user message
      const toolResultParts: string[] = [];

      for (const tc of roundToolCalls) {
        if (signal?.aborted) break;

        // Governor check
        const guardResult = this.deps.governor.canCallTool(tc.name);
        if (!guardResult.allowed) {
          toolCalls.push({ name: tc.name, input: tc.input, status: 'failed' });
          toolResultParts.push(`[Tool BLOCKED: ${tc.name}]\nGovernor blocked this call: ${guardResult.reason ?? 'rate limited'}`);
          continue;
        }

        emitter.emit({
          type: 'tool.call',
          operationId: operation.id,
          toolName: tc.name,
          status: 'running',
        });

        try {
          const result = await this.deps.capabilities.execute(tc.name, tc.input, signal);

          if (!result.success) {
            this.deps.governor.recordCall(tc.name, false);

            const failText = result.summary ?? 'Tool execution failed';
            toolCalls.push({ name: tc.name, input: tc.input, output: failText, status: 'failed' });

            emitter.emit({
              type: 'tool.call',
              operationId: operation.id,
              toolName: tc.name,
              status: 'failed',
              message: failText.substring(0, 200),
            });

            toolResultParts.push(`[Tool FAILED: ${tc.name}]\n${failText}\nDo NOT retry this tool. Briefly report the failure to the user.`);
            continue;
          }

          this.deps.governor.recordCall(tc.name, true);

          const resultText = formatToolResult(result);
          toolCalls.push({ name: tc.name, input: tc.input, output: resultText, status: 'completed' });

          emitter.emit({
            type: 'tool.call',
            operationId: operation.id,
            toolName: tc.name,
            status: 'completed',
            message: (result.summary ?? resultText).substring(0, 200),
          });

          toolResultParts.push(`[Tool result: ${tc.name}]\n${resultText}`);
        } catch (err) {
          this.deps.governor.recordCall(tc.name, false);

          const errMsg = err instanceof Error ? err.message : String(err);
          toolCalls.push({ name: tc.name, input: tc.input, output: errMsg, status: 'failed' });

          toolResultParts.push(`[Tool FAILED: ${tc.name}]\n${errMsg}\nDo NOT retry this tool. Briefly report the failure to the user.`);

          emitter.emit({
            type: 'tool.call',
            operationId: operation.id,
            toolName: tc.name,
            status: 'failed',
            message: errMsg,
          });
        }
      }

      // Feed all tool results back as a single user message for next round
      const toolResultPayload = toolResultParts.join('\n\n');
      if (toolResultParts.length > 0) {
        messages.push({ role: 'user', content: toolResultPayload });
      }

      this.log('[AgentExecutor] round end', {
        round,
        roundElapsedMs: Date.now() - roundStartTime,
        toolCallCount: roundToolCalls.length,
        toolNames: roundToolCalls.map((tc) => tc.name),
        toolResultChars: toolResultPayload.length,
        roundTextChars: roundText.length,
        cumulativeInputTokens: totalInput,
        cumulativeOutputTokens: totalOutput,
      });
    }

    return {
      text: fullText,
      toolCalls,
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
    };
  }
}

function buildPromptWithContext(operation: CopilotOperation): string {
  const blocks: string[] = [];
  const prompt = operation.prompt.trim();

  if (prompt.length > 0) {
    blocks.push(prompt);
  }

  const article = operation.context.article;
  if (article) {
    const articleLines = [
      article.articleTitle ? `Article Title: ${article.articleTitle}` : '',
      article.sectionTitle ? `Section Title: ${article.sectionTitle}` : '',
      article.previousSectionSummaries?.length
        ? `Previous Section Summaries: ${article.previousSectionSummaries.join(' | ')}`
        : '',
      article.nextSectionTitles?.length
        ? `Next Section Titles: ${article.nextSectionTitles.join(' | ')}`
        : '',
    ].filter((line) => line.length > 0);

    if (articleLines.length > 0) {
      blocks.push(`## Writing Target\n${articleLines.join('\n')}`);
    }
  }

  const writing = operation.context.writing;
  if (writing) {
    const writingLines = [
      article?.articleTitle ? `Document: ${article.articleTitle}` : 'Document: current writing workspace',
      article?.sectionTitle ? `Active Section: ${article.sectionTitle}` : '',
      `Unsaved Changes: ${writing.unsavedChanges ? 'yes' : 'no'}`,
    ].filter((line) => line.length > 0);

    blocks.push(`## Writing Session\n${writingLines.join('\n')}`);
  }

  const selection = operation.context.selection;
  if (selection?.kind === 'editor') {
    // For range selections: include the selected text
    if (selection.selectedText.trim().length > 0) {
      blocks.push(`## Selected Editor Text\n${selection.selectedText}`);
    }

    // For caret (continue-writing) and range: include surrounding context
    // so the LLM knows what precedes/follows the cursor.
    const beforeText = selection.beforeText;
    const afterText = selection.afterText;
    if (beforeText || afterText) {
      const contextLines: string[] = [];
      if (beforeText) contextLines.push(`### Text before cursor\n${beforeText}`);
      if (afterText) contextLines.push(`### Text after cursor\n${afterText}`);
      blocks.push(`## Editor Context\n${contextLines.join('\n\n')}`);
    }
  }

  if (selection?.kind === 'reader' && selection.selectedText.trim().length > 0) {
    blocks.push(`## Selected Reader Text\n${selection.selectedText}`);
  }

  const retrieval = operation.context.retrieval;
  if (retrieval.evidence.length > 0) {
    const evidenceLines = retrieval.evidence.slice(0, 5).map((evidence, index) => (
      `[${index + 1}] source=${evidence.citationLabel ?? `Source ${index + 1}`} score=${evidence.score.toFixed(3)}\n${evidence.text}`
    ));
    const retrievalHeader = retrieval.lastQuery
      ? `Query: ${retrieval.lastQuery}`
      : 'Query: (not provided)';
    blocks.push(`## Retrieved Evidence\n${retrievalHeader}\n\n${evidenceLines.join('\n\n')}`);
  }

  if (blocks.length === 0) {
    return operation.prompt;
  }

  return blocks.join('\n\n');
}

/**
 * Format an OperationResult for LLM feedback.
 *
 * Previously only `result.summary` was returned, so the model never saw the
 * actual data (e.g. search result papers, concept details). Now both summary
 * and data are included, with a size cap to avoid blowing up context.
 */
const TOOL_RESULT_DATA_CAP = 6000; // chars — roughly ≤ 2k tokens

function formatToolResult(result: OperationResult): string {
  const summary = result.summary ?? '';
  if (result.data == null) return summary || 'OK';

  const dataStr = JSON.stringify(result.data, null, 2);
  if (dataStr.length <= TOOL_RESULT_DATA_CAP) {
    return summary ? `${summary}\n\n${dataStr}` : dataStr;
  }
  // Truncate large payloads but keep summary intact
  return summary
    ? `${summary}\n\n${dataStr.slice(0, TOOL_RESULT_DATA_CAP)}…(truncated)`
    : `${dataStr.slice(0, TOOL_RESULT_DATA_CAP)}…(truncated)`;
}
