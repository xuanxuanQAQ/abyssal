/**
 * Agent Loop — tool-use conversation engine with streaming relay.
 *
 * Implements the §7.3 loop: stream LLM → on tool_use_end execute read-only
 * tool → append result → re-invoke LLM → max 10 rounds.
 *
 * History management (§7.4): 10-round trim, context window protection.
 *
 * See spec: section 7
 */

import type { LlmClient, Message, StreamChunk } from '../llm-client/llm-client';
import type { PushManager, AgentStreamChunk } from '../../electron/ipc/push';
import type { ToolRegistry } from './tool-registry';
import { buildSystemPrompt, type SystemPromptContext } from './system-prompt-builder';

// ─── Types ───

export interface AgentLoopOptions {
  llmClient: LlmClient;
  toolRegistry: ToolRegistry;
  pushManager: PushManager | null;
  getSystemPromptContext: () => Promise<SystemPromptContext>;
}

export interface ConversationState {
  messages: Message[];
  conversationId: string;
}

// ─── Agent Loop ───

export class AgentLoop {
  private readonly llmClient: LlmClient;
  private readonly toolRegistry: ToolRegistry;
  private readonly pushManager: PushManager | null;
  private readonly getCtx: () => Promise<SystemPromptContext>;

  constructor(opts: AgentLoopOptions) {
    this.llmClient = opts.llmClient;
    this.toolRegistry = opts.toolRegistry;
    this.pushManager = opts.pushManager;
    this.getCtx = opts.getSystemPromptContext;
  }

  /**
   * Run a single user turn through the agent loop.
   *
   * Streams tokens to PushManager, executes tools on tool_use_end,
   * re-invokes LLM with tool results, up to maxRounds.
   */
  async run(
    userMessage: string,
    conversation: ConversationState,
    signal?: AbortSignal,
  ): Promise<void> {
    const MAX_ROUNDS = 10;
    const conversationId = conversation.conversationId;

    // Build system prompt dynamically
    const promptCtx = await this.getCtx();
    const systemPrompt = buildSystemPrompt(promptCtx);

    // Append user message
    conversation.messages.push({ role: 'user', content: userMessage });

    // Trim history before calling (§7.4)
    this.trimHistory(conversation.messages);
    this.protectContextWindow(conversation.messages, systemPrompt);

    let fullText = '';
    let round = 0;

    // Tool hallucination detection: track recent tool calls to detect loops.
    const recentToolCalls: Array<{ name: string; argsHash: string }> = [];
    const DUPLICATE_WINDOW = 3;
    const MAX_TRACKED_CALLS = DUPLICATE_WINDOW * 2;

    // Zero-yield detection: count consecutive tool calls returning empty/trivial results.
    // Prevents LLM from wasting rounds on futile searches with slightly varied queries.
    let consecutiveEmptyResults = 0;
    const MAX_CONSECUTIVE_EMPTY = 3;

    while (round < MAX_ROUNDS) {
      if (signal?.aborted) break;

      const stream = this.llmClient.completeStream({
        systemPrompt,
        messages: conversation.messages,
        tools: this.toolRegistry.getToolDefinitions(),
        workflowId: 'agent',
        ...(signal != null && { signal }),
      });

      let needsReInvoke = false;

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        if (chunk.type === 'text_delta') {
          fullText += chunk.delta;
          this.push(conversationId, { type: 'text_delta', conversationId, delta: chunk.delta });
        } else if (chunk.type === 'tool_use_end') {
          // Execute tool
          this.push(conversationId, {
            type: 'tool_use_start',
            conversationId,
            toolName: chunk.name,
            args: chunk.input,
          });

          let toolResult: string;

          // Tool hallucination detection: check if same tool + similar args in recent calls
          const argsHash = simpleHash(chunk.name + JSON.stringify(chunk.input));
          const isDuplicate = recentToolCalls
            .slice(-DUPLICATE_WINDOW)
            .some((tc) => tc.name === chunk.name && tc.argsHash === argsHash);
          recentToolCalls.push({ name: chunk.name, argsHash });
          // Trim to prevent unbounded growth
          while (recentToolCalls.length > MAX_TRACKED_CALLS) recentToolCalls.shift();

          if (isDuplicate) {
            toolResult = `System Notice: You have repeatedly used tool "${chunk.name}" with similar parameters yielding no new results. DO NOT call this tool again for this sub-task. Provide your best answer based on existing context or state that the information is unavailable.`;
          } else if (consecutiveEmptyResults >= MAX_CONSECUTIVE_EMPTY) {
            // Zero-yield protection: too many empty results in a row
            toolResult = `System Notice: Your last ${MAX_CONSECUTIVE_EMPTY} tool calls returned empty or trivial results. Stop trying this approach. Either answer with what you already know, tell the user the information is unavailable, or try a fundamentally different tool/query.`;
            consecutiveEmptyResults = 0; // Reset to allow one more attempt if LLM changes strategy
          } else if (!this.toolRegistry.has(chunk.name)) {
            toolResult = `Error: Unknown tool '${chunk.name}'`;
          } else {
            try {
              const result = await this.toolRegistry.execute(chunk.name, chunk.input);
              toolResult = JSON.stringify(result, null, 2);
              if (toolResult.length > 50000) {
                toolResult = toolResult.slice(0, 50000) + '\n... [truncated]';
              }
              // Zero-yield detection: track empty/trivial results
              if (isEmptyResult(result)) {
                consecutiveEmptyResults++;
              } else {
                consecutiveEmptyResults = 0;
              }
            } catch (err) {
              toolResult = `Error executing tool: ${(err as Error).message}`;
              consecutiveEmptyResults++;
            }
          }

          this.push(conversationId, {
            type: 'tool_use_result',
            conversationId,
            toolName: chunk.name,
            result: toolResult,
          });

          // Append tool_use and tool_result to messages
          conversation.messages.push({
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: chunk.id,
              name: chunk.name,
              input: chunk.input,
            }],
          });
          conversation.messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              toolUseId: chunk.id,
              content: toolResult,
            }],
          });

          round++;
          needsReInvoke = true;
          break; // Break inner for-loop, continue while-loop
        } else if (chunk.type === 'message_end') {
          // Conversation turn complete
          conversation.messages.push({ role: 'assistant', content: fullText });

          this.push(conversationId, {
            type: 'done',
            conversationId,
            fullText,
            usage: chunk.usage,
          });
          return;
        } else if (chunk.type === 'error') {
          this.push(conversationId, {
            type: 'error',
            conversationId,
            code: chunk.code,
            message: chunk.message,
          });
          return;
        }
      }

      if (!needsReInvoke) break;
    }

    // Max rounds reached
    if (round >= MAX_ROUNDS) {
      fullText += '\n\n[Reached maximum tool-use rounds]';
    }
    conversation.messages.push({ role: 'assistant', content: fullText });
    this.push(conversationId, {
      type: 'done',
      conversationId,
      fullText,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }

  /**
   * Trim conversation history (§7.4).
   *
   * Strategy: sliding window discard (NOT internal compression).
   * - Always preserve the FIRST user message (original intent)
   * - Keep the most recent 6 rounds (12 messages) intact
   * - Discard everything in between — entire messages, not truncated fragments
   *
   * This ensures the LLM always sees logically complete context:
   * the original question + recent exchanges, with no "holes" from
   * truncated messages that would cause hallucination.
   */
  private trimHistory(messages: Message[]): void {
    const MAX_RECENT = 12; // 6 rounds × 2 messages
    if (messages.length <= MAX_RECENT + 1) return; // +1 for first message

    // Preserve first user message (original intent — never discard)
    const firstMessage = messages[0]!;

    // Keep the most recent MAX_RECENT messages intact
    const recent = messages.slice(-MAX_RECENT);

    // Discard everything in between (clean sliding window, no compression)
    messages.length = 0;
    messages.push(firstMessage, ...recent);
  }

  /**
   * Protect context window: remove oldest messages if total > 70% of window.
   *
   * Removes from index 1 (never index 0 = first user message / original intent).
   */
  private protectContextWindow(messages: Message[], systemPrompt: string): void {
    const windowSize = this.llmClient.getContextWindow('agent');
    const maxInput = windowSize * 0.7;

    let totalTokens = this.llmClient.countTokens(systemPrompt);
    for (const msg of messages) {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((b) => b.text ?? b.content ?? '').join('');
      totalTokens += this.llmClient.countTokens(text);
    }

    // Remove from index 1 (preserve first message = original intent)
    while (totalTokens > maxInput && messages.length > 3) {
      const removed = messages.splice(1, 1)[0]!;
      const text = typeof removed.content === 'string'
        ? removed.content
        : removed.content.map((b) => b.text ?? b.content ?? '').join('');
      totalTokens -= this.llmClient.countTokens(text);
    }
  }

  private push(conversationId: string, chunk: AgentStreamChunk): void {
    this.pushManager?.pushAgentStream(chunk);
  }
}

// ─── Helpers ───

/**
 * Detect empty/trivial tool results for zero-yield protection.
 * Returns true if the result is empty array, null, empty object, or error object.
 */
function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result) && result.length === 0) return true;
  if (typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (obj['error']) return true; // Error responses count as empty
    if (Object.keys(obj).length === 0) return true;
    // Check for { chunks: [] } pattern from RAG
    if (Array.isArray(obj['chunks']) && (obj['chunks'] as unknown[]).length === 0) return true;
    if (Array.isArray(obj['items']) && (obj['items'] as unknown[]).length === 0) return true;
  }
  return false;
}

/** Fast non-crypto hash for tool call deduplication. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
