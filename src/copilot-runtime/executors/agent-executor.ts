/**
 * AgentExecutor — interfaces with LLM + tool calling.
 *
 * Implements the unified executor interface for tool-use conversation loops.
 */

import type { LlmClient, StreamChunk } from '../../adapter/llm-client/llm-client';
import type { CapabilityRegistry } from '../../adapter/capabilities';
import type { ResearchSession } from '../../core/session/research-session';
import type { EventBus } from '../../core/event-bus';
import type { ToolCallingGovernor } from '../../adapter/orchestrator/tool-calling-governor';
import { classifyPromptGate } from '../../adapter/orchestrator/prompt-injection-gating';
import { routeToolFamilies, buildToolRouteInstruction } from '../../adapter/orchestrator/tool-routing';
import type { ToolRouteFamily } from '../../adapter/capabilities/types';
import type {
  CopilotOperation,
  ContextSnapshot,
  ExecutionStep,
} from '../types';
import type { OperationEventEmitter } from '../event-emitter';

export interface AgentExecutorDeps {
  llmClient: LlmClient;
  capabilities: CapabilityRegistry;
  session: ResearchSession;
  eventBus: EventBus;
  governor: ToolCallingGovernor;
  buildSystemPrompt: (operation: CopilotOperation) => Promise<string>;
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

  constructor(deps: AgentExecutorDeps) {
    this.deps = deps;
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

    // Reset governor for this operation
    this.deps.governor.reset();

    let fullText = '';
    const toolCalls: AgentExecutorResult['toolCalls'] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let round = 0;
    const maxRounds = 15;

    while (round < maxRounds) {
      round++;

      if (signal?.aborted) {
        break;
      }

      const stream = this.deps.llmClient.completeStream({
        systemPrompt,
        messages,
        ...(allowToolUse && tools.length > 0 ? { tools } : {}),
        ...(signal ? { signal } : {}),
      });

      let roundText = '';
      const roundToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      let currentToolId = '';
      let currentToolName = '';
      let currentToolInput = '';

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        switch (chunk.type) {
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
            currentToolId = chunk.id;
            currentToolName = chunk.name;
            currentToolInput = '';
            break;

          case 'tool_use_delta':
            currentToolInput += chunk.delta;
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

          case 'error':
            throw new Error(`LLM error: [${chunk.code}] ${chunk.message}`);
        }
      }

      fullText += roundText;

      // No tool calls → done
      if (roundToolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const tc of roundToolCalls) {
        if (signal?.aborted) break;

        // Governor check
        const guardResult = this.deps.governor.canCallTool(tc.name);
        if (!guardResult.allowed) {
          toolCalls.push({ name: tc.name, input: tc.input, status: 'failed' });
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
            // Capability returned a structured failure (not an exception).
            // Record as failed so governor tracks the miss, and feed an
            // explicit error signal back to the model so it stops retrying.
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

            // Tell the model this tool failed — use a clearly distinct format
            // so the model doesn't treat the error text as a successful result.
            messages.push({ role: 'assistant', content: roundText });
            messages.push({ role: 'user', content: `[Tool FAILED: ${tc.name}]\n${failText}\nDo NOT retry this tool. Proceed with generation using available context.` });
            continue;
          }

          this.deps.governor.recordCall(tc.name, true);

          const resultText = result.summary ?? JSON.stringify(result.data ?? '');
          toolCalls.push({ name: tc.name, input: tc.input, output: resultText, status: 'completed' });

          emitter.emit({
            type: 'tool.call',
            operationId: operation.id,
            toolName: tc.name,
            status: 'completed',
            message: resultText.substring(0, 200),
          });

          // Feed result back for next round
          messages.push({ role: 'assistant', content: roundText });
          messages.push({ role: 'user', content: `[Tool result: ${tc.name}]\n${resultText}` });
        } catch (err) {
          this.deps.governor.recordCall(tc.name, false);

          const errMsg = err instanceof Error ? err.message : String(err);
          toolCalls.push({ name: tc.name, input: tc.input, output: errMsg, status: 'failed' });

          emitter.emit({
            type: 'tool.call',
            operationId: operation.id,
            toolName: tc.name,
            status: 'failed',
            message: errMsg,
          });
        }
      }
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
  if (selection?.kind === 'editor' && selection.selectedText.trim().length > 0) {
    blocks.push(`## Selected Editor Text\n${selection.selectedText}`);
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
