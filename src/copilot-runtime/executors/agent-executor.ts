/**
 * AgentExecutor — interfaces with LLM + tool calling.
 *
 * Wraps the existing SessionOrchestrator/AgentLoop streaming logic
 * into the unified executor interface.
 */

import type { LlmClient, StreamChunk } from '../../adapter/llm-client/llm-client';
import type { CapabilityRegistry } from '../../adapter/capabilities';
import type { ResearchSession } from '../../core/session/research-session';
import type { EventBus } from '../../core/event-bus';
import type { ToolCallingGovernor } from '../../adapter/orchestrator/tool-calling-governor';
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
    const systemPrompt = await this.deps.buildSystemPrompt(operation);

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Add conversation context
    for (const turn of operation.context.conversation.recentTurns) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        messages.push({ role: turn.role, content: turn.text });
      }
    }

    // Add the current prompt
    messages.push({ role: 'user', content: buildPromptWithContext(operation) });

    // Build tool definitions based on operation constraints
    const tools = this.deps.capabilities.toToolDefinitions();

    const allowToolUse = step.mode !== 'patch'; // patch mode is pure generation

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
      `Article ID: ${article.articleId}`,
      article.articleTitle ? `Article Title: ${article.articleTitle}` : '',
      article.sectionId ? `Section ID: ${article.sectionId}` : '',
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
      `Editor ID: ${writing.editorId}`,
      `Writing Article ID: ${writing.articleId}`,
      writing.sectionId ? `Writing Section ID: ${writing.sectionId}` : '',
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
      `[${index + 1}] paper=${evidence.paperId} score=${evidence.score.toFixed(3)}\n${evidence.text}`
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
